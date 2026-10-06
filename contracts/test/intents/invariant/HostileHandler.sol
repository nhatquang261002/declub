// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeClubIntents} from "../../../src/DeClubIntents.sol";
import {IDeClubIntents} from "../../../src/interfaces/IDeClubIntents.sol";
import {MockERC20} from "../../../src/mocks/MockERC20.sol";
import {LyingNft, SoftNft} from "../../utils/WeirdTokens.sol";

/// @dev Signed pairs and rings over hostile collections, mixed with honest ones:
///      - `soft`, a SoftNft: a transfer it doesn't allow does nothing instead of reverting, so
///        only the contract's `ownerOf` checks stop a maker signing away an id held by someone
///        else, including the receiver itself;
///      - `liar`, a LyingNft: `transferFrom` never moves anything;
///      - type confusion: USDC given as an ERC-721 and a `soft` id given as an ERC-20.
///      Every maker signs, so the signature is never what stops a bad cycle: an honest cycle must
///      settle and pay everyone, and a cycle with any hostile give must revert.
contract HostileHandler is Test {
    uint256 public constant SOFT_PER_ACTOR = 5;
    uint256 public constant LIAR_BASE = 1000;
    uint256 public constant START_USDC = 1_000_000 ether;

    DeClubIntents public immutable SWAP;
    SoftNft public immutable SOFT;
    LyingNft public immutable LIAR;
    MockERC20 public immutable USDC;

    address[4] public actors;
    uint256[4] internal _keys;
    uint256 internal _nonce;

    uint256 public ghost_hostileSettled; // a cycle with a hostile give settled
    uint256 public ghost_validReverted; // an honest cycle reverted
    uint256 public ghost_badSettlement; // an NFT or USDC landed somewhere the cycle doesn't say

    mapping(bytes32 => uint256) public calls;

    constructor(DeClubIntents swap_, SoftNft soft_, LyingNft liar_, MockERC20 usdc_) {
        SWAP = swap_;
        SOFT = soft_;
        LIAR = liar_;
        USDC = usdc_;
        string[4] memory names = ["hAlice", "hBob", "hCarol", "hDave"];
        for (uint256 a; a < 4; ++a) {
            (actors[a], _keys[a]) = makeAddrAndKey(names[a]);
            for (uint256 k; k < SOFT_PER_ACTOR; ++k) {
                SOFT.mint(actors[a], a * SOFT_PER_ACTOR + k + 1);
            }
            LIAR.mint(actors[a], LIAR_BASE + a);
            USDC.mint(actors[a], START_USDC);
            vm.startPrank(actors[a]);
            SOFT.setApprovalForAll(address(SWAP), true);
            LIAR.setApprovalForAll(address(SWAP), true);
            USDC.approve(address(SWAP), type(uint256).max);
            vm.stopPrank();
        }
    }

    function softCount() external pure returns (uint256) {
        return 4 * SOFT_PER_ACTOR;
    }

    // ─────────────────────────────────────────────── settlements

    /// @dev i gives an NFT-ish asset to j for `amount` USDC. Kinds 0–3 are honest, 4–8 hostile.
    function settlePair(uint256 iSeed, uint256 jSeed, uint256 kind, uint256 seed) external {
        uint256 i = iSeed % 4;
        uint256 j = (i + 1 + jSeed % 3) % 4;
        (IDeClubIntents.Asset memory x, bool hostile, bool found) = _give(i, j, kind, seed);
        if (!found) return;
        IDeClubIntents.Asset memory cash = _usdc(bound(seed >> 128, 1, 1_000 ether));

        IDeClubIntents.Intent[] memory cycle = new IDeClubIntents.Intent[](2);
        cycle[0] = _intent(i, x, cash);
        cycle[1] = _intent(j, cash, x);
        _try(cycle, _who(i, j, 4), hostile, "pair");
    }

    /// @dev i gives x to j, j gives USDC to k, k gives y to i. Either NFT may be hostile.
    function settleRing(uint256 iSeed, uint256 step, uint256 kinds, uint256 seed) external {
        uint256 i = iSeed % 4;
        uint256 j = (i + 1 + step % 3) % 4;
        uint256 k = (i + 1 + (step >> 8) % 3) % 4;
        if (j == k) return;
        (IDeClubIntents.Asset memory x, bool hostileX, bool okX) = _give(i, j, kinds, seed);
        (IDeClubIntents.Asset memory y, bool hostileY, bool okY) =
            _give(k, i, kinds >> 8, seed >> 64);
        if (!okX || !okY) return;
        // Two gives of one id can't both be honest; skip the overlap rather than model it.
        if (x.token == y.token && x.id == y.id && x.assetType == y.assetType) return;
        IDeClubIntents.Asset memory cash = _usdc(bound(seed >> 128, 1, 1_000 ether));

        IDeClubIntents.Intent[] memory cycle = new IDeClubIntents.Intent[](3);
        cycle[0] = _intent(i, x, y);
        cycle[1] = _intent(j, cash, x);
        cycle[2] = _intent(k, y, cash);
        _try(cycle, _who(i, j, k), hostileX || hostileY, "ring");
    }

    /// @dev Actors pass `soft` ids between themselves, so a later honest give finds them
    ///      elsewhere.
    function moveSoft(uint256 idSeed, uint256 toSeed) external {
        uint256 id = idSeed % (4 * SOFT_PER_ACTOR) + 1;
        address owner = SOFT.ownerOf(id);
        vm.prank(owner);
        SOFT.transferFrom(owner, actors[toSeed % 4], id);
    }

    /// @dev Turns an actor's `soft` approval off or on. Without it SoftNft silently refuses the
    ///      contract's transfer, so a give that looks honest must still revert.
    function setSoftApproval(uint256 actorSeed, bool on) external {
        vm.prank(actors[actorSeed % 4]);
        SOFT.setApprovalForAll(address(SWAP), on);
    }

    // ─────────────────────────────────────────────── plumbing

    /// @dev What maker `from` gives to `to`:
    ///      0–3 a `soft` id `from` owns (honest only if `from` still approves the contract),
    ///      4 a `soft` id `to` already owns, 5 one a third actor owns, 6 `from`'s `liar` id,
    ///      7 USDC typed as an ERC-721, 8 a `soft` id typed as an ERC-20.
    function _give(uint256 from, uint256 to, uint256 kind, uint256 seed)
        internal
        view
        returns (IDeClubIntents.Asset memory a, bool hostile, bool found)
    {
        kind %= 9;
        if (kind <= 5) {
            uint256 owner = kind <= 3 ? from : kind == 4 ? to : _third(from, to, seed);
            (uint256 id, bool ok) = _softOwnedBy(actors[owner], seed);
            if (!ok) return (a, false, false);
            hostile = kind > 3 || !SOFT.isApprovedForAll(actors[from], address(SWAP));
            return (_nft(address(SOFT), id), hostile, true);
        }
        if (kind == 6) return (_nft(address(LIAR), LIAR_BASE + from), true, true);
        if (kind == 7) return (_nft(address(USDC), seed % 100), true, true);
        return
            (IDeClubIntents.Asset(IDeClubIntents.AssetType.ERC20, address(SOFT), 0, 1), true, true);
    }

    function _try(
        IDeClubIntents.Intent[] memory cycle,
        uint256[3] memory who,
        bool hostile,
        bytes32 label
    ) internal {
        uint256 n = cycle.length;
        bytes[] memory sigs = new bytes[](n);
        uint256[] memory usdcBefore = new uint256[](n);
        for (uint256 m; m < n; ++m) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(_keys[who[m]], SWAP.intentDigest(cycle[m]));
            sigs[m] = abi.encodePacked(r, s, v);
            usdcBefore[m] = USDC.balanceOf(cycle[m].maker);
        }

        try SWAP.settle(cycle, sigs) {
            calls[label]++;
            if (hostile) ghost_hostileSettled++;
            for (uint256 m; m < n; ++m) {
                IDeClubIntents.Intent memory it = cycle[m];
                address to = cycle[(m + 1) % n].maker;
                IDeClubIntents.Intent memory prev = cycle[(m + n - 1) % n];
                // Every give is one asset: an NFT lands with the next maker, and USDC nets out.
                if (it.give[0].token == address(SOFT) && SOFT.ownerOf(it.give[0].id) != to) {
                    ghost_badSettlement++;
                }
                uint256 gained = prev.give[0].token == address(USDC) ? prev.give[0].amount : 0;
                uint256 paid = it.give[0].token == address(USDC) ? it.give[0].amount : 0;
                if (USDC.balanceOf(it.maker) + paid != usdcBefore[m] + gained) {
                    ghost_badSettlement++;
                }
            }
        } catch {
            calls[hostile ? bytes32("refused") : bytes32("honestReverted")]++;
            if (!hostile) ghost_validReverted++;
        }
    }

    function _intent(
        uint256 who,
        IDeClubIntents.Asset memory give,
        IDeClubIntents.Asset memory want
    ) internal returns (IDeClubIntents.Intent memory) {
        IDeClubIntents.Asset[] memory g = new IDeClubIntents.Asset[](1);
        IDeClubIntents.Asset[] memory w = new IDeClubIntents.Asset[](1);
        (g[0], w[0]) = (give, want);
        // A fresh nonce every time: nonce reuse is the other suite's job.
        return IDeClubIntents.Intent(
            actors[who], g, w, SWAP.FEE_TOKEN(), 0, uint64(block.timestamp + 1 days), ++_nonce
        );
    }

    function _who(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[3] memory w) {
        (w[0], w[1], w[2]) = (a, b, c);
    }

    function _third(uint256 a, uint256 b, uint256 seed) internal pure returns (uint256) {
        for (uint256 k; k < 4; ++k) {
            uint256 c = (seed % 4 + k) % 4;
            if (c != a && c != b) return c;
        }
        return a; // unreachable with 4 actors
    }

    function _softOwnedBy(address who, uint256 seed) internal view returns (uint256, bool) {
        uint256 n = 4 * SOFT_PER_ACTOR;
        for (uint256 k; k < n; ++k) {
            uint256 id = (seed % n + k) % n + 1;
            if (SOFT.ownerOf(id) == who) return (id, true);
        }
        return (0, false);
    }

    function _nft(address token, uint256 id) internal pure returns (IDeClubIntents.Asset memory) {
        return IDeClubIntents.Asset(IDeClubIntents.AssetType.ERC721, token, id, 1);
    }

    function _usdc(uint256 amount) internal view returns (IDeClubIntents.Asset memory) {
        return IDeClubIntents.Asset(IDeClubIntents.AssetType.ERC20, address(USDC), 0, amount);
    }
}
