// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogSwapV2} from "../../../src/ChogSwapV2.sol";
import {IChogSwapV2} from "../../../src/interfaces/IChogSwapV2.sol";
import {MockChog} from "../../../src/mocks/MockChog.sol";
import {MockERC20} from "../../../src/mocks/MockERC20.sol";
import {MonReceiver} from "../../utils/Actors.sol";
import {BlocklistToken} from "../../utils/WeirdTokens.sol";

/// @dev Random create / fill / cancel / reclaim / claim / block / warp sequences over 3 EOAs and
///      1 MON-rejecting contract, trading native + two ERC-20s (one with a blocklist) + Chogs.
///      The invariants recompute escrow from the trades themselves, so the only ghost state is
///      the expected status per trade and a few counters that must stay 0.
contract Handler is Test {
    ChogSwapV2 public immutable swap;
    MockChog public immutable chog;
    MockERC20 public immutable usdc;
    BlocklistToken public immutable blk;

    address[] public actors;
    mapping(uint256 tradeId => IChogSwapV2.Status) public expectedStatus;

    uint256 public ghost_expiredFills; // I6
    uint256 public ghost_badSettlements; // fill moved assets to the wrong place
    uint256 public ghost_badRefunds; // I7
    uint256 public ghost_validFillReverted; // liveness: a valid fill must not revert
    uint256 public ghost_validCancelReverted; // a maker can always cancel

    mapping(bytes32 => uint256) public calls;

    constructor(ChogSwapV2 swap_, MockChog chog_, MockERC20 usdc_, BlocklistToken blk_) {
        swap = swap_;
        chog = chog_;
        usdc = usdc_;
        blk = blk_;

        actors.push(makeAddr("actor0"));
        actors.push(makeAddr("actor1"));
        actors.push(makeAddr("actor2"));
        actors.push(address(new MonReceiver())); // rejects MON → exercises native credits

        for (uint256 i; i < actors.length; ++i) {
            address a = actors[i];
            chog.mint(a, 6);
            usdc.mint(a, 100_000 ether);
            blk.mint(a, 100_000 ether);
            vm.deal(a, 10_000 ether);
            vm.startPrank(a);
            chog.setApprovalForAll(address(swap), true);
            usdc.approve(address(swap), type(uint256).max);
            blk.approve(address(swap), type(uint256).max);
            vm.stopPrank();
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    // ─────────────────────────────────────────────── actions

    function create(
        uint256 makerSeed,
        uint256 offeredMask,
        uint256 requestedMask,
        uint256 nftSeed,
        uint256 amountSeed,
        uint256 expirySeed,
        bool restrictTaker
    ) external {
        address maker = _actor(makerSeed);
        address counterparty = _actor(makerSeed + 1 + (requestedMask >> 8) % 3);

        // bit0 native, bit1 usdc, bit2 blk. The requested side never repeats an offered token.
        offeredMask &= 7;
        requestedMask = (requestedMask & 7) & ~offeredMask;

        uint256 nOfferedNft = bound(nftSeed, 0, 2);
        uint256 nRequestedNft = bound(nftSeed >> 8, 0, 2);
        IChogSwapV2.Asset[] memory offered = _side(maker, offeredMask, nOfferedNft, amountSeed);
        IChogSwapV2.Asset[] memory requested =
            _side(counterparty, requestedMask, nRequestedNft, amountSeed >> 16);
        if (offered.length == 0 || requested.length == 0) return;

        uint256 value;
        for (uint256 i; i < offered.length; ++i) {
            if (offered[i].assetType == IChogSwapV2.AssetType.Native) value = offered[i].amount;
        }
        uint64 expiry =
            expirySeed % 3 == 0 ? 0 : uint64(block.timestamp + bound(expirySeed, 1, 3 days));
        address taker = restrictTaker ? counterparty : address(0);

        vm.prank(maker);
        uint256 id = swap.createTrade{value: value}(offered, requested, taker, expiry);
        expectedStatus[id] = IChogSwapV2.Status.Open;
        calls["create"]++;
    }

    function fill(uint256 tradeSeed, uint256 takerSeed) external {
        (uint256 id, IChogSwapV2.Trade memory t, bool ok) = _openTrade(tradeSeed);
        if (!ok) return;

        address taker = t.taker != address(0) ? t.taker : _actor(takerSeed);
        if (taker == t.maker || !_canPay(taker, t)) return;

        bool expired = swap.isExpired(id);
        uint256[3] memory makerBefore = _holdings(t.maker);
        uint256[3] memory takerBefore = _holdings(taker);
        vm.prank(taker);
        try swap.fillTrade{value: _sum(t.requested, 0)}(id) {
            if (expired) ghost_expiredFills++;
            expectedStatus[id] = IChogSwapV2.Status.Filled;
            _checkNfts(t.offered, taker);
            _checkNfts(t.requested, t.maker);
            // The maker gains the requested side; the taker gains the offered side and pays the
            // requested one. A rejected payout shows up as a credit, which _holdings includes.
            if (!_gained(t.maker, makerBefore, t.requested, new IChogSwapV2.Asset[](0))) {
                ghost_badSettlements++;
            }
            if (!_gained(taker, takerBefore, t.offered, t.requested)) ghost_badSettlements++;
            calls["fill"]++;
        } catch {
            if (!expired) ghost_validFillReverted++;
        }
    }

    function cancel(uint256 tradeSeed) external {
        (uint256 id, IChogSwapV2.Trade memory t, bool ok) = _openTrade(tradeSeed);
        if (!ok) return;

        uint256[3] memory before = _holdings(t.maker);
        vm.prank(t.maker);
        try swap.cancelTrade(id) {
            expectedStatus[id] = IChogSwapV2.Status.Cancelled;
            _checkNfts(t.offered, t.maker);
            if (!_gained(t.maker, before, t.offered, new IChogSwapV2.Asset[](0))) {
                ghost_badRefunds++;
            }
            calls["cancel"]++;
        } catch {
            ghost_validCancelReverted++;
        }
    }

    function reclaim(uint256 tradeSeed, uint256 callerSeed) external {
        (uint256 id, IChogSwapV2.Trade memory t, bool ok) = _openTrade(tradeSeed);
        if (!ok || !swap.isExpired(id)) return;

        address caller = _actor(callerSeed);
        uint256[3] memory makerBefore = _holdings(t.maker);
        uint256[3] memory callerBefore = _holdings(caller);
        vm.prank(caller);
        try swap.reclaimExpired(id) {
            expectedStatus[id] = IChogSwapV2.Status.Cancelled;
            _checkNfts(t.offered, t.maker);
            if (!_gained(t.maker, makerBefore, t.offered, new IChogSwapV2.Asset[](0))) {
                ghost_badRefunds++;
            }
            // A caller who isn't the maker gets nothing.
            if (caller != t.maker) {
                uint256[3] memory callerAfter = _holdings(caller);
                for (uint256 i; i < 3; ++i) {
                    if (callerAfter[i] != callerBefore[i]) ghost_badRefunds++;
                }
            }
            calls["reclaim"]++;
        } catch {
            ghost_badRefunds++; // an expired open trade must always be reclaimable
        }
    }

    function claim(uint256 actorSeed, uint256 kind) external {
        address who = _actor(actorSeed);
        (IChogSwapV2.AssetType t, address token) = _fungible(kind);
        vm.prank(who);
        try swap.claim(t, token, 0) {
            calls["claim"]++;
        } catch {}
    }

    function setBlocked(uint256 actorSeed, bool blocked) external {
        blk.setBlocked(_actor(actorSeed), blocked);
        calls["block"]++;
    }

    function acceptMon(bool accept) external {
        MonReceiver(payable(actors[3])).setAccept(accept);
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    // ─────────────────────────────────────────────── helpers

    /// @dev Native, usdc, blk: wallet balance plus anything credited for `claim`.
    function _holdings(address who) internal view returns (uint256[3] memory h) {
        h[0] = who.balance + swap.claimable(who, IChogSwapV2.AssetType.Native, address(0), 0);
        h[1] = usdc.balanceOf(who)
            + swap.claimable(who, IChogSwapV2.AssetType.ERC20, address(usdc), 0);
        h[2] =
            blk.balanceOf(who) + swap.claimable(who, IChogSwapV2.AssetType.ERC20, address(blk), 0);
    }

    function _sum(IChogSwapV2.Asset[] memory assets, uint256 k)
        internal
        view
        returns (uint256 total)
    {
        for (uint256 i; i < assets.length; ++i) {
            IChogSwapV2.Asset memory a = assets[i];
            bool match_ = k == 0
                ? a.assetType == IChogSwapV2.AssetType.Native
                : a.token == (k == 1 ? address(usdc) : address(blk));
            if (match_) total += a.amount;
        }
    }

    /// @dev holdings(after) == holdings(before) + Σ gained − Σ paid, per fungible.
    function _gained(
        address who,
        uint256[3] memory before,
        IChogSwapV2.Asset[] memory gained,
        IChogSwapV2.Asset[] memory paid
    ) internal view returns (bool) {
        uint256[3] memory nowHeld = _holdings(who);
        for (uint256 k; k < 3; ++k) {
            if (nowHeld[k] + _sum(paid, k) != before[k] + _sum(gained, k)) return false;
        }
        return true;
    }

    function _checkNfts(IChogSwapV2.Asset[] memory assets, address expectedOwner) internal {
        for (uint256 i; i < assets.length; ++i) {
            if (
                assets[i].assetType == IChogSwapV2.AssetType.ERC721
                    && chog.ownerOf(assets[i].id) != expectedOwner
            ) {
                ghost_badSettlements++;
            }
        }
    }

    function _fungible(uint256 kind) internal view returns (IChogSwapV2.AssetType, address) {
        kind %= 3;
        if (kind == 0) return (IChogSwapV2.AssetType.Native, address(0));
        if (kind == 1) return (IChogSwapV2.AssetType.ERC20, address(usdc));
        return (IChogSwapV2.AssetType.ERC20, address(blk));
    }

    function _side(address owner, uint256 mask, uint256 nftCount, uint256 amountSeed)
        internal
        view
        returns (IChogSwapV2.Asset[] memory out)
    {
        uint256 bal = chog.balanceOf(owner);
        if (nftCount > bal) nftCount = bal;
        uint256 n = nftCount;
        for (uint256 b; b < 3; ++b) {
            if (mask & (1 << b) != 0) ++n;
        }
        out = new IChogSwapV2.Asset[](n);
        uint256 k;
        for (uint256 b; b < 3; ++b) {
            if (mask & (1 << b) == 0) continue;
            (IChogSwapV2.AssetType t, address token) = _fungible(b);
            uint256 amount = bound(amountSeed >> (b * 4), 1, 50) * 1 ether;
            out[k++] = IChogSwapV2.Asset(t, token, 0, amount);
        }
        for (uint256 i; i < nftCount; ++i) {
            out[k++] = IChogSwapV2.Asset(
                IChogSwapV2.AssetType.ERC721, address(chog), chog.tokenOfOwnerByIndex(owner, i), 1
            );
        }
    }

    /// @dev Only attempt fills a taker can really pay, so a revert means a bug.
    function _canPay(address taker, IChogSwapV2.Trade memory t) internal view returns (bool) {
        for (uint256 i; i < t.requested.length; ++i) {
            IChogSwapV2.Asset memory a = t.requested[i];
            if (a.assetType == IChogSwapV2.AssetType.Native) {
                if (taker.balance < a.amount) return false;
            } else if (a.assetType == IChogSwapV2.AssetType.ERC20) {
                if (IERC20Like(a.token).balanceOf(taker) < a.amount) return false;
                // A blocked maker can't receive the blocklist token, which reverts the fill.
                if (a.token == address(blk) && blk.blocked(t.maker)) return false;
            } else if (chog.ownerOf(a.id) != taker) {
                return false;
            }
        }
        return true;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _openTrade(uint256 seed)
        internal
        view
        returns (uint256 id, IChogSwapV2.Trade memory t, bool ok)
    {
        uint256 count = swap.tradeCount();
        if (count == 0) return (0, t, false);
        id = (seed % count) + 1;
        t = swap.getTrade(id);
        ok = t.status == IChogSwapV2.Status.Open;
    }
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
}
