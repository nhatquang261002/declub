// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ChogSwap} from "../../src/ChogSwap.sol";
import {IChogSwap} from "../../src/interfaces/IChogSwap.sol";
import {MockChog} from "../../src/mocks/MockChog.sol";
import {Handler} from "./Handler.sol";

/// @notice Invariants I1–I7 from docs/04-security.md.
contract ChogSwapInvariantTest is Test {
    MockChog internal chog;
    ChogSwap internal swap;
    Handler internal handler;

    function setUp() public {
        chog = new MockChog();
        swap = new ChogSwap(address(chog));
        handler = new Handler(swap, chog);
        targetContract(address(handler));
    }

    /// I1: every open trade's offered Chogs are held by the swap.
    function invariant_I1_openTradesAreEscrowed() public view {
        uint256 n = swap.tradeCount();
        for (uint256 id = 1; id <= n; ++id) {
            IChogSwap.Trade memory t = swap.getTrade(id);
            if (t.status != IChogSwap.Status.Open) continue;
            for (uint256 i; i < t.offeredIds.length; ++i) {
                assertEq(chog.ownerOf(t.offeredIds[i]), address(swap), "I1");
            }
        }
    }

    /// I2: the swap holds no Chog outside an open trade (with I1: exactly the open-trade set).
    function invariant_I2_noStrayChogs() public view {
        uint256 escrowed;
        uint256 n = swap.tradeCount();
        for (uint256 id = 1; id <= n; ++id) {
            IChogSwap.Trade memory t = swap.getTrade(id);
            if (t.status == IChogSwap.Status.Open) escrowed += t.offeredIds.length;
        }
        assertEq(chog.balanceOf(address(swap)), escrowed, "I2");
    }

    /// I3: MON held == open trades' offeredMon + outstanding credits.
    function invariant_I3_monAccounting() public view {
        uint256 owed;
        uint256 n = swap.tradeCount();
        for (uint256 id = 1; id <= n; ++id) {
            IChogSwap.Trade memory t = swap.getTrade(id);
            if (t.status == IChogSwap.Status.Open) owed += t.offeredMon;
        }
        for (uint256 i; i < handler.actorCount(); ++i) {
            owed += swap.pendingWithdrawal(handler.actors(i));
        }
        assertEq(address(swap).balance, owed, "I3");
    }

    /// I4 + I5: statuses only move along None → Open → {Filled, Cancelled}; ids are dense.
    function invariant_I4_I5_statusMachine() public view {
        uint256 n = swap.tradeCount();
        assertEq(n, handler.tradeIdCount(), "I5: tradeCount");
        for (uint256 id = 1; id <= n; ++id) {
            IChogSwap.Status s = swap.getTrade(id).status;
            assertTrue(s != IChogSwap.Status.None, "I5: gap");
            assertEq(uint8(s), uint8(handler.expectedStatus(id)), "I4");
        }
        assertEq(uint8(swap.getTrade(n + 1).status), uint8(IChogSwap.Status.None), "I5: beyond");
    }

    /// I6: nothing is filled after expiry.
    function invariant_I6_noExpiredFills() public view {
        assertEq(handler.ghost_expiredFills(), 0, "I6");
    }

    /// I7 (+ settlement): refunds go to the maker; fills route every Chog correctly.
    function invariant_I7_assetsRouteCorrectly() public view {
        assertEq(handler.ghost_badRefunds(), 0, "I7");
        assertEq(handler.ghost_badSettlements(), 0, "settlement");
    }

    /// Liveness: a fill whose preconditions hold never reverts.
    function invariant_validFillsSucceed() public view {
        assertEq(handler.ghost_validFillReverted(), 0, "liveness");
    }

    function afterInvariant() public view {
        console.log("create   ", handler.calls("create"));
        console.log("fill     ", handler.calls("fill"));
        console.log("fill_exp ", handler.calls("fill_expired"));
        console.log("cancel   ", handler.calls("cancel"));
        console.log("reclaim  ", handler.calls("reclaim"));
        console.log("withdraw ", handler.calls("withdraw"));
        console.log("wd_reject", handler.calls("withdraw_rejected"));
    }
}
