// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DeClubRewards} from "../../src/DeClubRewards.sol";
import {IDeClubRewards} from "../../src/interfaces/IDeClubRewards.sol";
import {DeClubRewardsBase, MonRefuser, ReentrantClaimer} from "./DeClubRewardsBase.sol";

/// @dev `claim` and `claimMany`: who gets paid, when, and what's refused.
contract DeClubRewardsClaimTest is DeClubRewardsBase {
    function test_eachLeafPaysItsAccountOnce() public {
        Drop memory d = _abc(1);
        _open(1, d);

        vm.expectEmit(true, true, false, true, address(rewards));
        emit IDeClubRewards.RewardClaimed(1, alice, 3 ether);
        vm.prank(alice);
        _claim(1, d, 0);

        assertEq(alice.balance, 3 ether);
        assertTrue(rewards.isClaimed(1, alice));
        assertFalse(rewards.isClaimed(1, bob));
        assertEq(rewards.epochs(1).claimed, 3 ether);
        assertEq(address(rewards).balance, 3 ether);

        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.AlreadyClaimed.selector, 1, alice));
        _claim(1, d, 0);
    }

    function test_anyoneCanClaimButTheMonGoesToTheAccount() public {
        Drop memory d = _abc(1);
        _open(1, d);
        vm.prank(stranger);
        _claim(1, d, 1);
        assertEq(bob.balance, 2 ether);
        assertEq(stranger.balance, 0);
    }

    function test_everyLeafClaimedEmptiesTheEpochExactly() public {
        Drop memory d = _abc(1);
        _open(1, d);
        for (uint256 i; i < 3; ++i) {
            _claim(1, d, i);
        }
        assertEq(rewards.epochs(1).claimed, rewards.epochs(1).total);
        assertEq(address(rewards).balance, 0);
        assertEq(alice.balance + bob.balance + carol.balance, 6 ether);
    }

    function test_aSingleLeafTreeHasAnEmptyProof() public {
        address[] memory accounts = new address[](1);
        accounts[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 5 ether;
        Drop memory d = _drop(1, accounts, amounts);
        assertEq(d.proofs[0].length, 0);
        assertEq(d.root, rewards.leaf(1, alice, 5 ether));
        _open(1, d);
        _claim(1, d, 0);
        assertEq(alice.balance, 5 ether);
    }

    function test_claimManyPaysAcrossEpochs() public {
        Drop memory one = _abc(1);
        Drop memory two = _abc(2);
        _publish(1, one);
        _publish(2, two);
        vm.warp(block.timestamp + DELAY);

        IDeClubRewards.Claim[] memory claims = new IDeClubRewards.Claim[](2);
        claims[0] = IDeClubRewards.Claim(1, alice, 3 ether, one.proofs[0]);
        claims[1] = IDeClubRewards.Claim(2, alice, 3 ether, two.proofs[0]);
        rewards.claimMany(claims);
        assertEq(alice.balance, 6 ether);
        assertTrue(rewards.isClaimed(1, alice));
        assertTrue(rewards.isClaimed(2, alice));
    }

    function test_claimManyIsAllOrNothing() public {
        Drop memory d = _abc(1);
        _open(1, d);
        IDeClubRewards.Claim[] memory claims = new IDeClubRewards.Claim[](2);
        claims[0] = IDeClubRewards.Claim(1, alice, 3 ether, d.proofs[0]);
        claims[1] = IDeClubRewards.Claim(1, alice, 3 ether, d.proofs[0]);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.AlreadyClaimed.selector, 1, alice));
        rewards.claimMany(claims);
        assertEq(alice.balance, 0);
        assertFalse(rewards.isClaimed(1, alice));
    }

    // ───────────────────────────────────────────── refusals

    function test_refusesAnUnknownEpoch() public {
        Drop memory d = _abc(1);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.UnknownEpoch.selector, 1));
        _claim(1, d, 0);
    }

    function test_waitsForTheDelay() public {
        Drop memory d = _abc(1);
        _publish(1, d);
        uint256 openAt = block.timestamp + DELAY;
        vm.warp(openAt - 1);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.NotOpenYet.selector, 1, openAt));
        _claim(1, d, 0);
        vm.warp(openAt);
        _claim(1, d, 0);
        assertEq(alice.balance, 3 ether);
    }

    function test_refusesAWrongAmountAccountOrProof() public {
        Drop memory d = _abc(1);
        _open(1, d);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.InvalidProof.selector, 1, alice, 4 ether));
        rewards.claim(1, alice, 4 ether, d.proofs[0]);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.InvalidProof.selector, 1, stranger, 3 ether));
        rewards.claim(1, stranger, 3 ether, d.proofs[0]);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.InvalidProof.selector, 1, alice, 3 ether));
        rewards.claim(1, alice, 3 ether, d.proofs[1]);
    }

    function test_aProofIsBoundToItsEpoch() public {
        Drop memory one = _abc(1);
        _open(1, one);
        // Epoch 2 is published with the same root: epoch 1's leaves don't hash the same in it.
        _publish(2, one);
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.InvalidProof.selector, 2, alice, 3 ether));
        rewards.claim(2, alice, 3 ether, one.proofs[0]);
    }

    function test_aProofIsBoundToItsDeploymentAndChain() public {
        Drop memory d = _abc(1);
        DeClubRewards other = new DeClubRewards(operator, 0, WINDOW);
        vm.prank(operator);
        other.publish{value: 6 ether}(1, d.root);
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.InvalidProof.selector, 1, alice, 3 ether));
        other.claim(1, alice, 3 ether, d.proofs[0]);

        bytes32 here = rewards.leaf(1, alice, 3 ether);
        vm.chainId(10143);
        assertTrue(rewards.leaf(1, alice, 3 ether) != here);
    }

    function test_aLeafIsHashedTwiceAndBoundToChainAndContract() public view {
        bytes32 inner = keccak256(abi.encode(block.chainid, address(rewards), uint64(1), alice, uint256(3 ether)));
        assertEq(rewards.leaf(1, alice, 3 ether), keccak256(bytes.concat(inner)));
    }

    function test_refusesTheZeroAccount() public {
        Drop memory d = _abc(1);
        _open(1, d);
        vm.expectRevert(IDeClubRewards.ZeroAccount.selector);
        rewards.claim(1, address(0), 3 ether, d.proofs[0]);
    }

    function test_aRootThatPromisesTooMuchCanOnlyPayItsOwnFunding() public {
        // Leaves sum to 6 MON, but only 4 are sent, beside another epoch's 6.
        Drop memory bad = _abc(1);
        vm.prank(operator);
        rewards.publish{value: 4 ether}(1, bad.root);
        _publish(2, _abc(2));
        vm.warp(block.timestamp + DELAY);

        _claim(1, bad, 0); // 3 of 4
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.OverClaim.selector, 1, 5 ether, 4 ether));
        _claim(1, bad, 1); // 2 more would be 5
        _claim(1, bad, 2); // 1 more is exactly 4
        assertEq(rewards.epochs(1).claimed, 4 ether);
        // Epoch 2's MON is untouched.
        assertEq(address(rewards).balance, 6 ether);
    }

    function test_anAccountThatRefusesMonCanTryAgainLater() public {
        MonRefuser refuser = new MonRefuser();
        address[] memory accounts = new address[](2);
        (accounts[0], accounts[1]) = (address(refuser), alice);
        uint256[] memory amounts = new uint256[](2);
        (amounts[0], amounts[1]) = (1 ether, 1 ether);
        Drop memory d = _drop(1, accounts, amounts);
        _open(1, d);

        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.PayoutFailed.selector, address(refuser)));
        _claim(1, d, 0);
        assertFalse(rewards.isClaimed(1, address(refuser)));
        assertEq(rewards.epochs(1).claimed, 0);
        _claim(1, d, 1);
        assertEq(alice.balance, 1 ether);
    }

    function test_aClaimCannotReenter() public {
        ReentrantClaimer claimer = new ReentrantClaimer(rewards);
        address[] memory accounts = new address[](2);
        (accounts[0], accounts[1]) = (address(claimer), alice);
        uint256[] memory amounts = new uint256[](2);
        (amounts[0], amounts[1]) = (1 ether, 1 ether);
        Drop memory d = _drop(1, accounts, amounts);
        _open(1, d);
        claimer.arm(1, 1 ether, d.proofs[0]);

        // The re-entry reverts inside `receive`, so the payout fails and the whole claim unwinds.
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.PayoutFailed.selector, address(claimer)));
        _claim(1, d, 0);
        assertFalse(rewards.isClaimed(1, address(claimer)));
        assertEq(address(rewards).balance, 2 ether);
    }

    function test_noDelayOpensClaimsAtOnce() public {
        DeClubRewards instant = new DeClubRewards(operator, 0, WINDOW);
        DeClubRewards saved = rewards;
        rewards = instant; // `_abc` hashes leaves for `rewards`
        Drop memory d = _abc(1);
        rewards = saved;
        vm.prank(operator);
        instant.publish{value: d.total}(1, d.root);
        instant.claim(1, alice, 3 ether, d.proofs[0]);
        assertEq(alice.balance, 3 ether);
    }
}
