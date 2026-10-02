// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OnDeal} from "../../src/OnDeal.sol";
import {IOnDeal} from "../../src/interfaces/IOnDeal.sol";
import {MockChog} from "../../src/mocks/MockChog.sol";
import {MonReceiver} from "../utils/Actors.sol";

/// @dev Drives random create / fill / cancel / reclaim / withdraw / warp sequences through a
///      fixed set of actors (3 EOAs + 1 contract that rejects MON) and keeps ghost state for
///      the invariants in OnDeal.invariant.t.sol.
contract Handler is Test {
    OnDeal public immutable swap;
    MockChog public immutable chog;

    address[] public actors;
    uint256[] public tradeIds;
    mapping(uint256 tradeId => IOnDeal.Status) public expectedStatus;

    // Ghost counters: every one must stay 0.
    uint256 public ghost_expiredFills; // I6
    uint256 public ghost_badSettlements; // fill moved assets to the wrong place
    uint256 public ghost_badRefunds; // I7
    uint256 public ghost_validFillReverted; // liveness: a valid fill must not revert

    // Call counters, for the summary.
    mapping(bytes32 => uint256) public calls;

    constructor(OnDeal swap_, MockChog chog_) {
        swap = swap_;
        chog = chog_;

        actors.push(makeAddr("actor0"));
        actors.push(makeAddr("actor1"));
        actors.push(makeAddr("actor2"));
        actors.push(address(new MonReceiver())); // rejects MON → exercises credits

        for (uint256 i; i < actors.length; ++i) {
            chog.mint(actors[i], 8);
            vm.deal(actors[i], 10_000 ether);
            vm.prank(actors[i]);
            chog.setApprovalForAll(address(swap), true);
        }
    }

    // ─────────────────────────────────────────────── actions

    function create(
        uint256 makerSeed,
        uint256 offeredSeed,
        uint256 requestedSeed,
        uint256 monSeed,
        uint256 expirySeed,
        bool restrictTaker
    ) external {
        address maker = _actor(makerSeed);

        uint256 bal = chog.balanceOf(maker);
        uint256 nOffered = bound(offeredSeed, 0, bal < 3 ? bal : 3);
        uint256[] memory offered = new uint256[](nOffered);
        for (uint256 i; i < nOffered; ++i) {
            offered[i] = chog.tokenOfOwnerByIndex(maker, i);
        }

        // Request 0–2 Chogs owned by one other actor (so a single taker can own them all).
        address counterparty = _actor(requestedSeed >> 8);
        uint256 cBal = counterparty == maker ? 0 : chog.balanceOf(counterparty);
        uint256 nRequested = bound(requestedSeed, 0, cBal < 2 ? cBal : 2);
        uint256[] memory requested = new uint256[](nRequested);
        for (uint256 i; i < nRequested; ++i) {
            requested[i] = chog.tokenOfOwnerByIndex(counterparty, i);
        }

        uint256 mon = bound(monSeed, 0, 5 ether);
        uint256 offeredMon = monSeed % 2 == 0 ? mon : 0;
        uint256 requestedMon = monSeed % 2 == 0 ? 0 : mon;

        if (nOffered == 0 && offeredMon == 0) return;
        if (nRequested == 0 && requestedMon == 0) return;

        uint64 expiry =
            expirySeed % 3 == 0 ? 0 : uint64(block.timestamp + bound(expirySeed, 1, 3 days));
        address taker = restrictTaker && nRequested > 0 ? counterparty : address(0);

        vm.prank(maker);
        uint256 id =
            swap.createTrade{value: offeredMon}(offered, requested, requestedMon, taker, expiry);

        tradeIds.push(id);
        expectedStatus[id] = IOnDeal.Status.Open;
        calls["create"]++;
    }

    function fill(uint256 tradeSeed, uint256 takerSeed) external {
        (uint256 id, IOnDeal.Trade memory t, bool ok) = _openTrade(tradeSeed);
        if (!ok) return;

        address taker;
        if (t.taker != address(0)) taker = t.taker;
        else if (t.requestedIds.length > 0) taker = chog.ownerOf(t.requestedIds[0]);
        else taker = _actor(takerSeed);
        if (taker == t.maker || taker == address(swap)) return;
        for (uint256 i; i < t.requestedIds.length; ++i) {
            if (chog.ownerOf(t.requestedIds[i]) != taker) return; // requested Chog moved on
        }

        bool expired = swap.isExpired(id);
        vm.prank(taker);
        try swap.fillTrade{value: t.requestedMon}(id) {
            if (expired) ghost_expiredFills++;
            expectedStatus[id] = IOnDeal.Status.Filled;
            for (uint256 i; i < t.offeredIds.length; ++i) {
                if (chog.ownerOf(t.offeredIds[i]) != taker) ghost_badSettlements++;
            }
            for (uint256 i; i < t.requestedIds.length; ++i) {
                if (chog.ownerOf(t.requestedIds[i]) != t.maker) ghost_badSettlements++;
            }
            calls["fill"]++;
        } catch {
            if (!expired) ghost_validFillReverted++;
            calls["fill_expired"]++;
        }
    }

    function cancel(uint256 tradeSeed) external {
        (uint256 id, IOnDeal.Trade memory t, bool ok) = _openTrade(tradeSeed);
        if (!ok) return;

        vm.prank(t.maker);
        swap.cancelTrade(id);

        expectedStatus[id] = IOnDeal.Status.Cancelled;
        _checkRefunded(t);
        calls["cancel"]++;
    }

    function reclaim(uint256 tradeSeed, uint256 callerSeed) external {
        (uint256 id, IOnDeal.Trade memory t, bool ok) = _openTrade(tradeSeed);
        if (!ok || !swap.isExpired(id)) return;

        vm.prank(_actor(callerSeed));
        swap.reclaimExpired(id);

        expectedStatus[id] = IOnDeal.Status.Cancelled;
        _checkRefunded(t);
        calls["reclaim"]++;
    }

    function withdraw(uint256 actorSeed) external {
        address who = _actor(actorSeed);
        if (swap.pendingWithdrawal(who) == 0) return;
        vm.prank(who);
        try swap.withdraw() {
            calls["withdraw"]++;
        } catch {
            calls["withdraw_rejected"]++; // the MonReceiver actor never accepts
        }
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
        calls["warp"]++;
    }

    // ─────────────────────────────────────────────── views for invariants

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function tradeIdCount() external view returns (uint256) {
        return tradeIds.length;
    }

    // ─────────────────────────────────────────────── internals

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }

    function _openTrade(uint256 seed)
        private
        view
        returns (uint256 id, IOnDeal.Trade memory t, bool ok)
    {
        if (tradeIds.length == 0) return (0, t, false);
        id = tradeIds[seed % tradeIds.length];
        t = swap.getTrade(id);
        ok = t.status == IOnDeal.Status.Open;
    }

    function _checkRefunded(IOnDeal.Trade memory t) private {
        for (uint256 i; i < t.offeredIds.length; ++i) {
            if (chog.ownerOf(t.offeredIds[i]) != t.maker) ghost_badRefunds++;
        }
    }
}
