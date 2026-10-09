// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IDeClubRewards} from "../../src/interfaces/IDeClubRewards.sol";
import {DeClubRewardsBase, MonRefuser} from "./DeClubRewardsBase.sol";

/// @dev Ending an epoch: `revoke` before claims open, `sweep` after the window.
contract DeClubRewardsCloseTest is DeClubRewardsBase {
    // ───────────────────────────────────────────── revoke

    function test_revokeRefundsInFullAndFreesTheEpoch() public {
        Drop memory d = _abc(1);
        _publish(1, d);
        uint256 before = operator.balance;

        vm.expectEmit(true, false, false, true, address(rewards));
        emit IDeClubRewards.EpochRevoked(1, 6 ether);
        vm.prank(operator);
        rewards.revoke(1);

        assertEq(operator.balance, before + 6 ether);
        assertEq(address(rewards).balance, 0);
        assertEq(rewards.epochs(1).root, bytes32(0));

        // A fixed root can be published under the same epoch.
        _publish(1, _abc(1));
        assertEq(rewards.epochs(1).total, 6 ether);
    }

    function test_revokeIsTooLateOnceClaimsOpen() public {
        Drop memory d = _abc(1);
        _publish(1, d);
        vm.warp(block.timestamp + DELAY);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.RevokeTooLate.selector, 1));
        rewards.revoke(1);
    }

    function test_revokeRefusesAStrangerAndAnUnknownEpoch() public {
        _publish(1, _abc(1));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.NotOperator.selector, stranger));
        rewards.revoke(1);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.UnknownEpoch.selector, 9));
        rewards.revoke(9);
    }

    function test_revokeFailsIfTheOperatorRefusesMon() public {
        MonRefuser refuser = new MonRefuser();
        vm.prank(operator);
        rewards.transferOperator(address(refuser));
        vm.prank(address(refuser));
        rewards.acceptOperator();

        Drop memory d = _abc(1);
        vm.deal(address(refuser), 6 ether);
        vm.prank(address(refuser));
        rewards.publish{value: 6 ether}(1, d.root);
        vm.prank(address(refuser));
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubRewards.PayoutFailed.selector, address(refuser))
        );
        rewards.revoke(1);
        // Nothing changed: the epoch is still there with its MON.
        assertEq(rewards.epochs(1).total, 6 ether);
        assertEq(address(rewards).balance, 6 ether);
    }

    // ───────────────────────────────────────────── sweep

    function test_sweepReturnsWhatsLeftAfterTheWindow() public {
        Drop memory d = _abc(1);
        _open(1, d);
        _claim(1, d, 0); // Alice takes 3
        uint256 sweepAt = block.timestamp + WINDOW;

        vm.warp(sweepAt - 1);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.SweepTooEarly.selector, 1, sweepAt));
        rewards.sweep(1);

        vm.warp(sweepAt);
        uint256 before = operator.balance;
        vm.expectEmit(true, true, false, true, address(rewards));
        emit IDeClubRewards.EpochSwept(1, operator, 3 ether);
        vm.prank(operator);
        rewards.sweep(1);
        assertEq(operator.balance, before + 3 ether);
        assertTrue(rewards.epochs(1).closed);

        // Bob's leaf can't be paid any more, and the epoch can't be swept twice.
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.EpochClosed.selector, 1));
        _claim(1, d, 1);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.EpochClosed.selector, 1));
        rewards.sweep(1);
        // Nor can it be published again.
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.EpochExists.selector, 1));
        rewards.publish{value: 1 ether}(1, d.root);
    }

    function test_sweepingAFullyClaimedEpochSendsNothing() public {
        Drop memory d = _abc(1);
        _open(1, d);
        for (uint256 i; i < 3; ++i) {
            _claim(1, d, i);
        }
        vm.warp(block.timestamp + WINDOW);
        uint256 before = operator.balance;
        vm.prank(operator);
        rewards.sweep(1);
        assertEq(operator.balance, before);
        assertTrue(rewards.epochs(1).closed);
    }

    function test_sweepTakesOnlyItsOwnEpoch() public {
        Drop memory one = _abc(1);
        _open(1, one);
        vm.warp(block.timestamp + WINDOW);
        _publish(2, _abc(2));
        vm.prank(operator);
        rewards.sweep(1);
        assertEq(address(rewards).balance, 6 ether);
        assertFalse(rewards.epochs(2).closed);
    }

    function test_sweepRefusesAStrangerAndAnUnknownEpoch() public {
        _open(1, _abc(1));
        vm.warp(block.timestamp + WINDOW);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.NotOperator.selector, stranger));
        rewards.sweep(1);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.UnknownEpoch.selector, 2));
        rewards.sweep(2);
    }
}
