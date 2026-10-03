// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OnDealV2} from "../../../src/OnDealV2.sol";
import {IOnDealV2} from "../../../src/interfaces/IOnDealV2.sol";
import {MockERC20} from "../../../src/mocks/MockERC20.sol";
import {LyingNft, SoftNft} from "../../utils/WeirdTokens.sol";

/// @dev Random trades, open offers and proposals over hostile collections, mixed with honest
///      ones so the escrow is always holding something worth stealing:
///      - `soft`, a SoftNft: a transfer it doesn't allow does nothing instead of reverting, so
///        only the contract's own `ownerOf` checks stop a deposit or fill of an id the caller
///        doesn't own (another actor's, or one already in escrow);
///      - `liar`, a LyingNft: `transferFrom` never moves anything;
///      - type confusion: an ERC-20 sent as an ERC-721 and an NFT sent as an ERC-20.
///      Each attempt knows whether it is honest. An honest one must succeed and land where the
///      terms say; a hostile one must revert. The counters below must stay 0, and the invariants
///      recompute what escrow must hold from the trades themselves.
contract HostileHandler is Test {
    uint256 public constant SOFT_PER_ACTOR = 6;
    uint256 public constant LIAR_BASE = 1000;

    OnDealV2 public immutable swap;
    SoftNft public immutable soft;
    LyingNft public immutable liar;
    MockERC20 public immutable usdc;

    address[3] public actors;

    uint256 public ghost_hostileAccepted; // a hostile create / propose / fill went through
    uint256 public ghost_validReverted; // an honest call reverted
    uint256 public ghost_badSettlement; // an NFT or ERC-20 ended up somewhere the terms don't say

    mapping(bytes32 => uint256) public calls;

    constructor(OnDealV2 swap_, SoftNft soft_, LyingNft liar_, MockERC20 usdc_) {
        swap = swap_;
        soft = soft_;
        liar = liar_;
        usdc = usdc_;
        for (uint256 a; a < 3; ++a) {
            address who = makeAddr(string.concat("hostile", vm.toString(a)));
            actors[a] = who;
            for (uint256 k; k < SOFT_PER_ACTOR; ++k) {
                soft.mint(who, a * SOFT_PER_ACTOR + k + 1);
            }
            liar.mint(who, LIAR_BASE + a);
            usdc.mint(who, 1_000_000 ether);
            vm.deal(who, 1_000_000 ether);
            vm.startPrank(who);
            soft.setApprovalForAll(address(swap), true);
            liar.setApprovalForAll(address(swap), true);
            usdc.approve(address(swap), type(uint256).max);
            vm.stopPrank();
        }
    }

    function softCount() external pure returns (uint256) {
        return 3 * SOFT_PER_ACTOR;
    }

    // ─────────────────────────────────────────────── honest actions

    /// @dev A trade with honest sides, optionally asking for a `liar` id too. Creating it must
    ///      work (the ask isn't checked until a fill), and no fill of it may ever go through.
    function create(uint256 makerSeed, uint256 counterSeed, uint256 offerSeed, uint256 askSeed)
        external
    {
        uint256 m = makerSeed % 3;
        uint256 c = (m + 1 + counterSeed % 2) % 3;
        IOnDealV2.Asset[] memory offered = _honestSide(m, offerSeed, false);
        bool offersUsdc = offerSeed & 1 != 0;
        // One ask in eight also wants a `liar` id, which no fill may ever deliver.
        IOnDealV2.Asset[] memory requested =
            _honestSide(c, offersUsdc ? askSeed & ~uint256(1) : askSeed, (askSeed >> 3) % 8 == 0);
        if (offered.length == 0 || requested.length == 0) return;

        uint256 value = swap.fee();
        vm.prank(actors[m]);
        try swap.createTrade{value: value}(
            offered, requested, counterSeed & 4 != 0 ? actors[c] : address(0), 0
        ) {
            calls["create"]++;
        } catch {
            ghost_validReverted++;
        }
    }

    function createOffer(uint256 makerSeed, uint256 offerSeed) external {
        uint256 m = makerSeed % 3;
        IOnDealV2.Asset[] memory offered = _honestSide(m, offerSeed, false);
        if (offered.length == 0) return;
        uint256 value = swap.fee();
        vm.prank(actors[m]);
        try swap.createOpenOffer{value: value}(offered, address(0), 0, "") {
            calls["offer"]++;
        } catch {
            ghost_validReverted++;
        }
    }

    /// @dev Fill an open trade. It must go through exactly when the taker really holds every
    ///      requested asset and none of them is a `liar` id; then each side's NFTs and USDC must
    ///      have moved. Three calls in four look for a trade some actor can pay for, the fourth
    ///      sends a random taker at a random trade.
    function fill(uint256 tradeSeed, uint256 takerSeed) external {
        uint256 id;
        IOnDealV2.Trade memory t;
        address taker;
        bool ok;
        if (takerSeed % 4 == 0) {
            (id, t, ok) = _openTrade(tradeSeed, false);
            taker = t.taker != address(0) ? t.taker : actors[(takerSeed >> 2) % 3];
        } else {
            (id, t, taker, ok) = _fillableTrade(tradeSeed);
        }
        if (!ok || taker == t.maker) return;

        bool honest = _holdsAll(taker, t.requested);
        uint256 makerUsdc = usdc.balanceOf(t.maker);
        uint256 takerUsdc = usdc.balanceOf(taker);
        vm.prank(taker);
        try swap.fillTrade{value: t.fee}(id) {
            calls["fill"]++;
            if (!honest) ghost_hostileAccepted++;
            _expectOwner(t.offered, taker);
            _expectOwner(t.requested, t.maker);
            if (usdc.balanceOf(t.maker) != makerUsdc + _usdcIn(t.requested)) ghost_badSettlement++;
            if (usdc.balanceOf(taker) + _usdcIn(t.requested) != takerUsdc + _usdcIn(t.offered)) {
                ghost_badSettlement++;
            }
        } catch {
            calls["fillRefused"]++;
            if (honest) ghost_validReverted++;
        }
    }

    /// @dev Propose to an open offer: honest assets the proposer holds, or one of the hostile
    ///      shapes, which must revert.
    function propose(uint256 tradeSeed, uint256 proposerSeed, uint256 kind, uint256 seed) external {
        (uint256 id, IOnDealV2.Trade memory t, bool ok) = _openTrade(tradeSeed, true);
        if (!ok) return;
        uint256 p = proposerSeed % 3;
        if (actors[p] == t.maker) return;

        IOnDealV2.Asset[] memory assets;
        bool hostile = kind % 2 == 0;
        if (hostile) {
            bool found;
            (assets, found) = _hostileAsset(p, (kind >> 1) % 5, seed);
            if (!found) return;
        } else {
            assets = _honestSide(p, _usdcIn(t.offered) != 0 ? seed & ~uint256(1) : seed, false);
            if (assets.length == 0) return;
        }

        vm.prank(actors[p]);
        try swap.propose{value: t.fee}(id, assets) {
            calls["propose"]++;
            if (hostile) ghost_hostileAccepted++;
        } catch {
            if (!hostile) ghost_validReverted++;
        }
    }

    function acceptProposal(uint256 tradeSeed, uint256 pidSeed) external {
        (uint256 id, IOnDealV2.Trade memory t, bool ok) = _openTrade(tradeSeed, true);
        if (!ok) return;
        (uint256 pid, IOnDealV2.Proposal memory p, bool active) = _activeProposal(id, pidSeed);
        if (!active) return;

        vm.prank(t.maker);
        try swap.acceptProposal(id, pid) {
            calls["accept"]++;
            _expectOwner(t.offered, p.proposer);
            _expectOwner(p.assets, t.maker);
        } catch {
            ghost_validReverted++;
        }
    }

    function withdrawProposal(uint256 tradeSeed, uint256 pidSeed) external {
        uint256 count = swap.tradeCount();
        if (count == 0) return;
        uint256 id = tradeSeed % count + 1;
        (uint256 pid, IOnDealV2.Proposal memory p, bool active) = _activeProposal(id, pidSeed);
        if (!active) return;

        vm.prank(p.proposer);
        try swap.withdrawProposal(id, pid) {
            calls["withdraw"]++;
            _expectOwner(p.assets, p.proposer);
        } catch {
            ghost_validReverted++;
        }
    }

    /// @dev An open trade (not an open offer), from a random start, with a taker allowed to fill
    ///      it who holds everything it asks for.
    function _fillableTrade(uint256 seed)
        internal
        view
        returns (uint256 id, IOnDealV2.Trade memory t, address taker, bool ok)
    {
        uint256 count = swap.tradeCount();
        for (uint256 k; k < count; ++k) {
            id = (seed % count + k) % count + 1;
            t = swap.getTrade(id);
            if (t.status != IOnDealV2.Status.Open || t.requested.length == 0) continue;
            for (uint256 a; a < 3; ++a) {
                taker = actors[a];
                if (taker == t.maker || (t.taker != address(0) && t.taker != taker)) continue;
                if (_holdsAll(taker, t.requested)) return (id, t, taker, true);
            }
        }
        return (0, t, address(0), false);
    }

    /// @dev Only one call in four cancels, so trades live long enough to be filled.
    function cancel(uint256 tradeSeed, bool offer) external {
        if (tradeSeed % 4 != 0) return;
        (uint256 id, IOnDealV2.Trade memory t, bool ok) = _openTrade(tradeSeed >> 2, offer);
        if (!ok) return;
        vm.prank(t.maker);
        try swap.cancelTrade(id) {
            calls["cancel"]++;
            _expectOwner(t.offered, t.maker);
        } catch {
            ghost_validReverted++;
        }
    }

    /// @dev Actors pass `soft` ids between themselves, so open asks go stale and ids an actor
    ///      offered before end up with someone else.
    function moveSoft(uint256 idSeed, uint256 toSeed) external {
        uint256 id = idSeed % (3 * SOFT_PER_ACTOR) + 1;
        address owner = soft.ownerOf(id);
        if (owner == address(swap)) return;
        vm.prank(owner);
        soft.transferFrom(owner, actors[toSeed % 3], id);
    }

    // ─────────────────────────────────────────────── hostile actions

    /// @dev A trade whose offered side is hostile (kinds 0–4), or whose ask is type-confused
    ///      (kinds 5–6). Every one must revert.
    function createHostile(uint256 makerSeed, uint256 kind, uint256 seed) external {
        uint256 m = makerSeed % 3;
        kind %= 7;
        IOnDealV2.Asset[] memory offered;
        IOnDealV2.Asset[] memory requested =
            _one(IOnDealV2.Asset(IOnDealV2.AssetType.Native, address(0), 0, 1 ether));
        bool found;
        if (kind < 5) {
            (offered, found) = _hostileAsset(m, kind, seed);
            if (!found) return;
        } else {
            offered = _one(IOnDealV2.Asset(IOnDealV2.AssetType.ERC20, address(usdc), 0, 1 ether));
            requested = kind == 5
                ? _one(IOnDealV2.Asset(IOnDealV2.AssetType.ERC721, address(usdc), seed % 100, 1))
                : _one(IOnDealV2.Asset(IOnDealV2.AssetType.ERC20, address(soft), 0, 1));
        }

        uint256 value = swap.fee();
        vm.prank(actors[m]);
        try swap.createTrade{value: value}(offered, requested, address(0), 0) {
            ghost_hostileAccepted++;
        } catch {
            calls["hostileRefused"]++;
        }
    }

    // ─────────────────────────────────────────────── helpers

    /// @dev One hostile asset for actor `a` to deposit:
    ///      0 a `soft` id another actor owns, 1 a `soft` id already in escrow, 2 a `liar` id `a`
    ///      owns, 3 USDC typed as an ERC-721, 4 a `soft` id typed as an ERC-20.
    function _hostileAsset(uint256 a, uint256 kind, uint256 seed)
        internal
        view
        returns (IOnDealV2.Asset[] memory out, bool found)
    {
        if (kind == 0 || kind == 1) {
            address want = kind == 0 ? actors[(a + 1 + seed % 2) % 3] : address(swap);
            (uint256 id, bool ok) = _softOwnedBy(want, seed);
            if (!ok) return (out, false);
            return (_one(IOnDealV2.Asset(IOnDealV2.AssetType.ERC721, address(soft), id, 1)), true);
        }
        if (kind == 2) {
            return (
                _one(IOnDealV2.Asset(IOnDealV2.AssetType.ERC721, address(liar), LIAR_BASE + a, 1)),
                true
            );
        }
        if (kind == 3) {
            return
                (
                    _one(IOnDealV2.Asset(IOnDealV2.AssetType.ERC721, address(usdc), seed % 100, 1)),
                    true
                );
        }
        return (_one(IOnDealV2.Asset(IOnDealV2.AssetType.ERC20, address(soft), 0, 1)), true);
    }

    /// @dev bit0 USDC, bits 1–2 up to two `soft` ids `a` owns, and `withLiar` adds `a`'s liar id.
    function _honestSide(uint256 a, uint256 seed, bool withLiar)
        internal
        view
        returns (IOnDealV2.Asset[] memory out)
    {
        uint256[2] memory ids;
        uint256 nNft;
        uint256 want = (seed >> 1) % 3;
        for (uint256 k; k < 3 * SOFT_PER_ACTOR && nNft < want; ++k) {
            uint256 id = (seed >> 8) % (3 * SOFT_PER_ACTOR) + 1;
            id = (id - 1 + k) % (3 * SOFT_PER_ACTOR) + 1;
            if (soft.ownerOf(id) == actors[a]) ids[nNft++] = id;
        }
        bool withUsdc = seed & 1 != 0;
        uint256 n = nNft + (withUsdc ? 1 : 0) + (withLiar ? 1 : 0);
        out = new IOnDealV2.Asset[](n);
        uint256 i;
        if (withUsdc) {
            out[i++] = IOnDealV2.Asset(
                IOnDealV2.AssetType.ERC20, address(usdc), 0, bound(seed >> 64, 1, 50) * 1 ether
            );
        }
        for (uint256 k; k < nNft; ++k) {
            out[i++] = IOnDealV2.Asset(IOnDealV2.AssetType.ERC721, address(soft), ids[k], 1);
        }
        if (withLiar) {
            out[i] = IOnDealV2.Asset(IOnDealV2.AssetType.ERC721, address(liar), LIAR_BASE + a, 1);
        }
    }

    /// @dev Whether `who` really holds every asset (a `liar` id never counts: it can't move).
    function _holdsAll(address who, IOnDealV2.Asset[] memory assets) internal view returns (bool) {
        for (uint256 i; i < assets.length; ++i) {
            IOnDealV2.Asset memory a = assets[i];
            if (a.token == address(liar)) return false;
            if (a.token == address(soft) && soft.ownerOf(a.id) != who) return false;
            if (a.token == address(usdc) && usdc.balanceOf(who) < a.amount) return false;
        }
        return true;
    }

    function _expectOwner(IOnDealV2.Asset[] memory assets, address expected) internal {
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i].token == address(soft) && soft.ownerOf(assets[i].id) != expected) {
                ghost_badSettlement++;
            }
        }
    }

    function _usdcIn(IOnDealV2.Asset[] memory assets) internal view returns (uint256 sum) {
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i].token == address(usdc)) sum += assets[i].amount;
        }
    }

    function _softOwnedBy(address who, uint256 seed) internal view returns (uint256, bool) {
        uint256 n = 3 * SOFT_PER_ACTOR;
        for (uint256 k; k < n; ++k) {
            uint256 id = (seed % n + k) % n + 1;
            if (soft.ownerOf(id) == who) return (id, true);
        }
        return (0, false);
    }

    /// @dev The first open trade from a random start that is (`offer`) or isn't an open offer,
    ///      so most calls land on something they can act on.
    function _openTrade(uint256 seed, bool offer)
        internal
        view
        returns (uint256 id, IOnDealV2.Trade memory t, bool ok)
    {
        uint256 count = swap.tradeCount();
        for (uint256 k; k < count; ++k) {
            id = (seed % count + k) % count + 1;
            t = swap.getTrade(id);
            if (t.status == IOnDealV2.Status.Open && (t.requested.length == 0) == offer) {
                return (id, t, true);
            }
        }
    }

    function _activeProposal(uint256 id, uint256 seed)
        internal
        view
        returns (uint256 pid, IOnDealV2.Proposal memory p, bool ok)
    {
        uint256 n = swap.proposalCount(id);
        if (n == 0) return (0, p, false);
        pid = seed % n;
        p = swap.getProposal(id, pid);
        ok = p.status == IOnDealV2.ProposalStatus.Active;
    }

    function _one(IOnDealV2.Asset memory a) internal pure returns (IOnDealV2.Asset[] memory r) {
        r = new IOnDealV2.Asset[](1);
        r[0] = a;
    }
}
