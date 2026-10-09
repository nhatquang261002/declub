// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IDeClubRewards} from "../../src/interfaces/IDeClubRewards.sol";
import {DeClubRewardsBase} from "./DeClubRewardsBase.sol";

contract DeClubRewardsFuzzTest is DeClubRewardsBase {
    /// @dev Any set of leaves, claimed in any order, pays every account exactly its amount and
    ///      leaves nothing behind.
    function testFuzz_everyLeafPaysExactlyItsAmount(uint8 count, uint256 seed) public {
        uint256 n = bound(count, 1, 24);
        address[] memory accounts = new address[](n);
        uint256[] memory amounts = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            accounts[i] = address(uint160(0x1000 + i));
            amounts[i] = bound(uint256(keccak256(abi.encode(seed, i))), 1, 10 ether);
        }
        Drop memory d = _drop(3, accounts, amounts);
        vm.deal(operator, d.total);
        _open(3, d);

        // Claim from the last leaf back, so the order differs from the tree's.
        for (uint256 i = n; i > 0; --i) {
            _claim(3, d, i - 1);
        }
        for (uint256 i; i < n; ++i) {
            assertEq(accounts[i].balance, amounts[i]);
        }
        assertEq(address(rewards).balance, 0);
        assertEq(rewards.epochs(3).claimed, d.total);
    }

    /// @dev No leaf is paid for an amount other than its own.
    function testFuzz_aLeafNeverPaysAnotherAmount(uint256 asked) public {
        Drop memory d = _abc(1);
        _open(1, d);
        vm.assume(asked != 3 ether);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubRewards.InvalidProof.selector, 1, alice, asked)
        );
        rewards.claim(1, alice, asked, d.proofs[0]);
    }

    /// @dev Claims open exactly `CLAIM_DELAY` after publishing, and revoking works only before.
    function testFuzz_delayBoundary(uint256 wait) public {
        wait = bound(wait, 0, 3 days);
        Drop memory d = _abc(1);
        _publish(1, d);
        uint256 openAt = block.timestamp + DELAY;
        vm.warp(block.timestamp + wait);
        if (block.timestamp < openAt) {
            vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.NotOpenYet.selector, 1, openAt));
            _claim(1, d, 0);
            vm.prank(operator);
            rewards.revoke(1);
        } else {
            _claim(1, d, 0);
            vm.prank(operator);
            vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.RevokeTooLate.selector, 1));
            rewards.revoke(1);
        }
    }

    /// @dev Only the operator publishes, revokes or sweeps.
    function testFuzz_onlyTheOperatorRunsEpochs(address caller) public {
        vm.assume(caller != operator);
        Drop memory d = _abc(1);
        _publish(1, d);
        vm.deal(caller, 1 ether);
        vm.startPrank(caller);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.NotOperator.selector, caller));
        rewards.publish{value: 1 ether}(2, d.root);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.NotOperator.selector, caller));
        rewards.revoke(1);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.NotOperator.selector, caller));
        rewards.sweep(1);
        vm.stopPrank();
    }
}
