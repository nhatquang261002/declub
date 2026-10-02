// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OnDealIntents} from "../../../src/OnDealIntents.sol";
import {IOnDealIntents} from "../../../src/interfaces/IOnDealIntents.sol";
import {MockChog} from "../../../src/mocks/MockChog.sol";
import {MockERC20} from "../../../src/mocks/MockERC20.sol";

/// @dev Drives random pair and ring settlements with signed intents, including ones that must
///      fail: reused or invalidated nonces, moved NFTs, drained or un-approved ERC-20s, and
///      expired deadlines. Ghost state records what the contract must never allow.
contract Handler is Test {
    OnDealIntents public immutable SWAP;
    MockChog public immutable CHOG;
    MockERC20 public immutable USDC;
    MockERC20 public immutable WETH;

    address[4] public actors;
    uint256[4] internal _keys;

    /// @dev Small nonce range on purpose, so collisions and reuse happen constantly (still
    ///      big enough that a run doesn't exhaust every nonce).
    uint256 public constant NONCE_RANGE = 24;

    mapping(address => mapping(uint256 => bool)) public settledNonce;
    mapping(address => mapping(uint256 => bool)) public invalidatedNonce;

    uint256 public settlements;
    /// @dev Makers across all settled cycles: each paid one fee.
    uint256 public settledMakers;
    uint256 public attempts;
    bool public nonceSettledTwice;
    bool public invalidatedNonceSettled;
    bool public settledAfterDeadline;

    constructor(
        OnDealIntents swap_,
        MockChog chog_,
        MockERC20 usdc_,
        MockERC20 weth_,
        address[4] memory actors_,
        uint256[4] memory keys_
    ) {
        SWAP = swap_;
        CHOG = chog_;
        USDC = usdc_;
        WETH = weth_;
        actors = actors_;
        _keys = keys_;
    }

    // ─────────────────────────────────────────────── settlements

    /// @dev i gives a Chog it owns for at least `ask` USDC; j pays `ask + extra`, or one short of
    ///      `ask` one time in eight, which must fail.
    function settlePair(
        uint256 iSeed,
        uint256 jSeed,
        uint256 idSeed,
        uint256 ask,
        uint256 extra,
        uint256 seed
    ) external {
        uint256 i = bound(iSeed, 0, 3);
        uint256 j = (i + bound(jSeed, 1, 3)) % 4;
        (uint256 id, bool ok) = _ownedBy(i, idSeed);
        if (!ok) return;
        ask = bound(ask, 2, 200 ether);
        uint256 pay = extra % 8 == 0 ? ask - 1 : ask + bound(extra, 0, 100 ether);
        uint64 deadline = uint64(block.timestamp + bound(seed >> 128, 1, 2 days));

        IOnDealIntents.Intent[] memory cycle = new IOnDealIntents.Intent[](2);
        cycle[0] = _intent(i, _one(_nft(id)), _one(_erc20(address(USDC), ask)), seed, deadline);
        cycle[1] =
            _intent(j, _one(_erc20(address(USDC), pay)), _one(_nft(id)), seed >> 64, deadline);
        uint256[] memory who = new uint256[](2);
        (who[0], who[1]) = (i, j);
        _trySettle(cycle, who);
    }

    /// @dev i → j → k → i: i gives a Chog, j gives WETH, k gives USDC.
    function settleRing(uint256 iSeed, uint256 stepSeed, uint256 idSeed, uint256 amountSeed)
        external
    {
        uint256 i = bound(iSeed, 0, 3);
        uint256 j = (i + bound(stepSeed, 1, 3)) % 4;
        uint256 k = (i + bound(stepSeed >> 64, 1, 3)) % 4;
        if (j == k) return; // three distinct makers
        (uint256 id, bool ok) = _ownedBy(i, idSeed);
        if (!ok) return;
        _ring(i, j, k, id, amountSeed);
    }

    function _ring(uint256 i, uint256 j, uint256 k, uint256 id, uint256 amountSeed) internal {
        uint256 amountW = bound(amountSeed, 1, 100 ether);
        uint256 amountU = bound(amountSeed >> 128, 1, 100 ether);
        uint256 nonce = amountSeed >> 200;
        uint64 deadline = uint64(block.timestamp + 1 days);

        IOnDealIntents.Intent[] memory cycle = new IOnDealIntents.Intent[](3);
        cycle[0] = _intent(i, _one(_nft(id)), _one(_erc20(address(USDC), amountU)), nonce, deadline);
        cycle[1] = _intent(j, _one(_erc20(address(WETH), amountW)), _one(_nft(id)), nonce, deadline);
        cycle[2] = _intent(
            k,
            _one(_erc20(address(USDC), amountU)),
            _one(_erc20(address(WETH), amountW)),
            nonce,
            deadline
        );
        uint256[] memory who = new uint256[](3);
        (who[0], who[1], who[2]) = (i, j, k);
        _trySettle(cycle, who);
    }

    // ─────────────────────────────────────────────── things that make settlements fail

    function invalidate(uint256 actorSeed, uint256 nonce) external {
        uint256 a = bound(actorSeed, 0, 3);
        nonce = bound(nonce, 0, NONCE_RANGE - 1);
        vm.prank(actors[a]);
        SWAP.invalidateNonces(0, 1 << nonce);
        invalidatedNonce[actors[a]][nonce] = true;
    }

    function moveNft(uint256 fromSeed, uint256 toSeed, uint256 id) external {
        id = bound(id, 1, 20);
        address owner = CHOG.ownerOf(id);
        address to = actors[bound(toSeed, 0, 3)];
        vm.prank(owner);
        CHOG.transferFrom(owner, to, id);
        fromSeed;
    }

    function setUsdcApproval(uint256 actorSeed, bool on) external {
        vm.prank(actors[bound(actorSeed, 0, 3)]);
        USDC.approve(address(SWAP), on ? type(uint256).max : 0);
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 12 hours));
    }

    // ─────────────────────────────────────────────── plumbing

    /// @dev A Chog id currently owned by actor `who`, searching from a random starting id.
    function _ownedBy(uint256 who, uint256 seed) internal view returns (uint256 id, bool ok) {
        uint256 start = bound(seed, 1, 20);
        for (uint256 k; k < 20; ++k) {
            id = ((start - 1 + k) % 20) + 1;
            if (CHOG.ownerOf(id) == actors[who]) return (id, true);
        }
        return (0, false);
    }

    function _trySettle(IOnDealIntents.Intent[] memory cycle, uint256[] memory who) internal {
        ++attempts;
        bytes[] memory sigs = new bytes[](cycle.length);
        for (uint256 n; n < cycle.length; ++n) {
            sigs[n] = _sign(_keys[who[n]], cycle[n]);
        }
        try SWAP.settle(cycle, sigs) {
            ++settlements;
            settledMakers += cycle.length;
            for (uint256 n; n < cycle.length; ++n) {
                address maker = cycle[n].maker;
                uint256 nonce = cycle[n].nonce;
                if (settledNonce[maker][nonce]) nonceSettledTwice = true;
                if (invalidatedNonce[maker][nonce]) invalidatedNonceSettled = true;
                if (block.timestamp > cycle[n].deadline) settledAfterDeadline = true;
                settledNonce[maker][nonce] = true;
            }
        } catch {}
    }

    function _intent(
        uint256 who,
        IOnDealIntents.Asset[] memory give,
        IOnDealIntents.Asset[] memory want,
        uint256 nonce,
        uint64 deadline
    ) internal view returns (IOnDealIntents.Intent memory) {
        return IOnDealIntents.Intent(
            actors[who],
            give,
            want,
            SWAP.FEE_TOKEN(),
            SWAP.FEE_AMOUNT(),
            deadline,
            bound(nonce, 0, NONCE_RANGE - 1)
        );
    }

    function _sign(uint256 key, IOnDealIntents.Intent memory it)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, SWAP.intentDigest(it));
        return abi.encodePacked(r, s, v);
    }

    function _nft(uint256 id) internal view returns (IOnDealIntents.Asset memory) {
        return IOnDealIntents.Asset(IOnDealIntents.AssetType.ERC721, address(CHOG), id, 1);
    }

    function _erc20(address token, uint256 amount)
        internal
        pure
        returns (IOnDealIntents.Asset memory)
    {
        return IOnDealIntents.Asset(IOnDealIntents.AssetType.ERC20, token, 0, amount);
    }

    function _one(IOnDealIntents.Asset memory a)
        internal
        pure
        returns (IOnDealIntents.Asset[] memory r)
    {
        r = new IOnDealIntents.Asset[](1);
        r[0] = a;
    }
}
