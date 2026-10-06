// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeClubRewards} from "../../../src/DeClubRewards.sol";
import {IDeClubRewards} from "../../../src/interfaces/IDeClubRewards.sol";
import {RewardsHandler} from "./Handler.sol";

/// @dev R1–R4, and every call behaving as the handler's books say, over random publish /
///      claim / revoke / sweep / warp sequences, some of them with underfunded roots.
contract DeClubRewardsInvariantTest is Test {
    DeClubRewards internal rewards;
    RewardsHandler internal handler;

    function setUp() public {
        address operator = makeAddr("operator");
        rewards = new DeClubRewards(operator, 1 days, 30 days);
        handler = new RewardsHandler(rewards, operator);
        targetContract(address(handler));
    }

    /// @dev R1: the contract holds exactly what its open epochs still owe.
    function invariant_balanceIsWhatOpenEpochsStillHold() public view {
        uint256 owed;
        for (uint256 i; i < handler.epochCount(); ++i) {
            uint64 epoch = handler.epochList(i);
            IDeClubRewards.Epoch memory e = rewards.epochs(epoch);
            if (e.root == bytes32(0) || e.closed) continue;
            owed += uint256(e.total) - e.claimed;
            assertEq(uint256(e.total) - e.claimed, handler.ghost_left(epoch), "epoch books differ");
        }
        assertEq(address(rewards).balance, owed);
    }

    /// @dev R2: no epoch pays out more than it was funded with.
    function invariant_noEpochPaysMoreThanItsFunding() public view {
        for (uint256 i; i < handler.epochCount(); ++i) {
            IDeClubRewards.Epoch memory e = rewards.epochs(handler.epochList(i));
            assertLe(e.claimed, e.total);
        }
    }

    /// @dev R3: no leaf is paid twice.
    function invariant_noLeafIsPaidTwice() public view {
        for (uint256 i; i < handler.epochCount(); ++i) {
            uint64 epoch = handler.epochList(i);
            for (uint256 h; h < 4; ++h) {
                assertLe(handler.ghost_paidTimes(epoch, handler.holders(h)), 1);
            }
        }
    }

    /// @dev R4: every wei that stayed in either went to a Holder, was swept, or is still held.
    function invariant_monIsConserved() public view {
        assertEq(
            handler.ghost_funded(),
            handler.ghost_received() + handler.ghost_swept() + address(rewards).balance
        );
    }

    /// @dev Every call did what the handler's books said it would.
    function invariant_everyCallBehaved() public view {
        assertEq(handler.ghost_violations(), 0, handler.lastViolation());
    }

    function invariant_callSummary() public view {
        // Not an assertion: shows the run did real work (forge test -vv).
        handler.calls_publish();
        handler.calls_claim();
        handler.calls_revoke();
        handler.calls_sweep();
    }
}
