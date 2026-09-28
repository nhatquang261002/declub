// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IChogSwap} from "../src/interfaces/IChogSwap.sol";
import {ChogSwapBase} from "./utils/ChogSwapBase.sol";
import {ReentrantReceiver} from "./utils/Actors.sol";

/// @dev Each MON payout hands control to the recipient. Every re-entry attempt must hit the guard.
contract ChogSwapReentrancyTest is ChogSwapBase {
    ReentrantReceiver internal attacker;
    uint256 internal constant X1 = 16; // first Chog minted to `attacker`

    function setUp() public override {
        super.setUp();
        attacker = new ReentrantReceiver();
        _onboard(address(attacker));
    }

    function _assertBlocked() internal view {
        assertTrue(attacker.attempted(), "re-entry was not attempted");
        assertFalse(attacker.reentrySucceeded(), "re-entry succeeded");
        assertEq(
            bytes4(attacker.reentryRevertData()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
    }

    function test_makerCannotCancelDuringFill() public {
        // Attacker is maker; receives requestedMon during fill and tries to cancel.
        uint256 id = _create(address(attacker), _ids(X1), 0, _ids(B1), 1 ether);
        attacker.arm(address(swap), abi.encodeCall(IChogSwap.cancelTrade, (id)));

        _fill(bob, id);

        _assertBlocked();
        _assertOwner(X1, bob);
        _assertOwner(B1, address(attacker));
        assertEq(uint8(_status(id)), uint8(IChogSwap.Status.Filled));
    }

    function test_takerCannotRefillDuringFill() public {
        // Attacker is taker; receives offeredMon during fill and tries to fill again.
        uint256 id = _create(alice, _ids(A1), 2 ether, _ids(X1), 0);
        attacker.arm(address(swap), abi.encodeCall(IChogSwap.fillTrade, (id)));

        _fill(address(attacker), id);

        _assertBlocked();
        assertEq(address(attacker).balance, START_MON + 2 ether);
        assertEq(address(swap).balance, 0);
    }

    function test_takerCannotWithdrawDuringFill() public {
        uint256 id = _create(alice, _ids(A1), 2 ether, _ids(X1), 0);
        attacker.arm(address(swap), abi.encodeCall(IChogSwap.withdraw, ()));

        _fill(address(attacker), id);

        _assertBlocked();
    }

    /// The exact path Slither flags as reentrancy-eth: the maker receives requestedMon mid-fill,
    /// before the taker's credit is written, and re-enters withdraw().
    function test_makerCannotWithdrawDuringFill() public {
        uint256 id = _create(address(attacker), _ids(X1), 0, _ids(B1), 1 ether);
        attacker.arm(address(swap), abi.encodeCall(IChogSwap.withdraw, ()));

        _fill(bob, id);

        _assertBlocked();
        assertEq(address(swap).balance, 0);
        assertEq(swap.pendingWithdrawal(address(attacker)), 0);
    }

    function test_makerCannotDoubleCancel() public {
        uint256 id = _create(address(attacker), _ids(X1), 3 ether, _ids(B1), 0);
        attacker.arm(address(swap), abi.encodeCall(IChogSwap.cancelTrade, (id)));

        vm.prank(address(attacker));
        swap.cancelTrade(id);

        _assertBlocked();
        assertEq(address(attacker).balance, START_MON, "refunded exactly once");
        assertEq(address(swap).balance, 0);
    }

    function test_makerCannotCreateDuringReclaim() public {
        uint64 expiry = uint64(block.timestamp + 1);
        uint256 id = _create(address(attacker), _ids(X1), 1 ether, _ids(B1), 0, address(0), expiry);
        attacker.arm(
            address(swap),
            abi.encodeCall(IChogSwap.createTrade, (_ids(X1), _ids(B1), 0, address(0), 0))
        );
        vm.warp(expiry + 1);

        swap.reclaimExpired(id);

        _assertBlocked();
        assertEq(swap.tradeCount(), 1);
    }
}
