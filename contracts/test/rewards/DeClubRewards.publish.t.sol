// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DeClubRewards} from "../../src/DeClubRewards.sol";
import {IDeClubRewards} from "../../src/interfaces/IDeClubRewards.sol";
import {DeClubRewardsBase} from "./DeClubRewardsBase.sol";

/// @dev The constructor, `publish` and the operator role.
contract DeClubRewardsPublishTest is DeClubRewardsBase {
    // ───────────────────────────────────────────── constructor

    function test_constructorSetsTheRoleAndTiming() public view {
        assertEq(rewards.operator(), operator);
        assertEq(rewards.pendingOperator(), address(0));
        assertEq(rewards.CLAIM_DELAY(), DELAY);
        assertEq(rewards.CLAIM_WINDOW(), WINDOW);
        assertEq(rewards.MAX_CLAIM_DELAY(), 7 days);
        assertEq(rewards.MIN_CLAIM_WINDOW(), 1 days);
        assertEq(rewards.MAX_CLAIM_WINDOW(), 365 days);
    }

    function test_constructorEmitsTheFirstOperator() public {
        vm.expectEmit(true, true, false, false);
        emit IDeClubRewards.OperatorTransferred(address(0), operator);
        new DeClubRewards(operator, 0, 1 days);
    }

    function test_constructorRefusesAZeroOperator() public {
        vm.expectRevert(IDeClubRewards.NoOperator.selector);
        new DeClubRewards(address(0), DELAY, WINDOW);
    }

    function test_constructorRefusesTimingOutOfBounds() public {
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubRewards.BadTiming.selector, 7 days + 1, WINDOW)
        );
        new DeClubRewards(operator, 7 days + 1, WINDOW);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubRewards.BadTiming.selector, DELAY, 1 days - 1)
        );
        new DeClubRewards(operator, DELAY, 1 days - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubRewards.BadTiming.selector, DELAY, 365 days + 1)
        );
        new DeClubRewards(operator, DELAY, 365 days + 1);
        // The bounds themselves are fine.
        new DeClubRewards(operator, 7 days, 365 days);
        new DeClubRewards(operator, 0, 1 days);
    }

    // ───────────────────────────────────────────── publish

    function test_publishStoresTheEpochAndHoldsItsMon() public {
        Drop memory d = _abc(1);
        uint256 openAt = block.timestamp + DELAY;

        vm.expectEmit(true, false, false, true, address(rewards));
        emit IDeClubRewards.EpochPublished(1, d.root, 6 ether, openAt);
        _publish(1, d);

        IDeClubRewards.Epoch memory e = rewards.epochs(1);
        assertEq(e.root, d.root);
        assertEq(e.total, 6 ether);
        assertEq(e.claimed, 0);
        assertEq(e.openAt, openAt);
        assertFalse(e.closed);
        assertEq(address(rewards).balance, 6 ether);
    }

    function test_epochsArePublishedInAnyOrder() public {
        _publish(7, _abc(7));
        _publish(2, _abc(2));
        assertEq(rewards.epochs(7).total, 6 ether);
        assertEq(rewards.epochs(2).total, 6 ether);
        assertEq(address(rewards).balance, 12 ether);
    }

    function test_publishRefusesAStranger() public {
        Drop memory d = _abc(1);
        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.NotOperator.selector, stranger));
        rewards.publish{value: 6 ether}(1, d.root);
    }

    function test_publishRefusesAnEpochTwice() public {
        Drop memory d = _abc(1);
        _publish(1, d);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.EpochExists.selector, 1));
        rewards.publish{value: 6 ether}(1, d.root);
    }

    function test_publishRefusesAnEmptyRootOrNoMon() public {
        vm.startPrank(operator);
        vm.expectRevert(IDeClubRewards.EmptyRoot.selector);
        rewards.publish{value: 1 ether}(1, bytes32(0));
        vm.expectRevert(IDeClubRewards.NothingFunded.selector);
        rewards.publish(1, keccak256("root"));
        vm.stopPrank();
    }

    function test_rewardsRefusesPlainMon() public {
        vm.prank(operator);
        (bool ok,) = address(rewards).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // ───────────────────────────────────────────── operator role

    function test_operatorHandsTheRoleOnInTwoSteps() public {
        vm.prank(operator);
        vm.expectEmit(true, true, false, false);
        emit IDeClubRewards.OperatorTransferStarted(operator, bob);
        rewards.transferOperator(bob);
        assertEq(rewards.pendingOperator(), bob);
        assertEq(rewards.operator(), operator);

        vm.prank(bob);
        vm.expectEmit(true, true, false, false);
        emit IDeClubRewards.OperatorTransferred(operator, bob);
        rewards.acceptOperator();
        assertEq(rewards.operator(), bob);
        assertEq(rewards.pendingOperator(), address(0));

        // The old operator can't publish any more; the new one can.
        Drop memory d = _abc(1);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.NotOperator.selector, operator));
        rewards.publish{value: 6 ether}(1, d.root);
        vm.deal(bob, 6 ether);
        vm.prank(bob);
        rewards.publish{value: 6 ether}(1, d.root);
    }

    function test_aZeroNextCancelsAHandover() public {
        vm.startPrank(operator);
        rewards.transferOperator(bob);
        rewards.transferOperator(address(0));
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.NotPendingOperator.selector, bob));
        rewards.acceptOperator();
    }

    function test_onlyTheOperatorStartsAHandoverAndOnlyThePendingOneAccepts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.NotOperator.selector, stranger));
        rewards.transferOperator(stranger);

        vm.prank(operator);
        rewards.transferOperator(bob);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubRewards.NotPendingOperator.selector, stranger)
        );
        rewards.acceptOperator();
        // With nothing pending, the zero address can't "accept" either.
        vm.prank(address(0));
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubRewards.NotPendingOperator.selector, address(0))
        );
        rewards.acceptOperator();
    }
}
