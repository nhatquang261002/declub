// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeClubRewards} from "../../src/DeClubRewards.sol";

/// @dev A root and proof built by the web app's epoch builder (web/lib/rewards.ts,
///      web/lib/merkle.ts; the "cross-check with the contract" case in web/test/rewards.test.ts)
///      must verify here. Chain 10143, the contract at 0x…ee, epoch 4: Alice 3 MON, Bob 2, Carol 1.
///      Rebuild both sides together if either encoding changes.
contract DeClubRewardsLeafFixtureTest is Test {
    address internal constant AT = 0x00000000000000000000000000000000000000eE;
    address internal constant ALICE = 0xAAaA000000000000000000000000000000000001;
    address internal constant OPERATOR = address(0x0b);
    bytes32 internal constant ROOT =
        0x900ceb6b4bf39dfec8495853b364500f485ff7d96e81b0b3c48b73c3fe604c65;

    function test_aRootBuiltByTheWebAppPays() public {
        vm.chainId(10143);
        deployCodeTo(
            "DeClubRewards.sol:DeClubRewards",
            abi.encode(OPERATOR, uint256(0), uint256(90 days)),
            AT
        );
        DeClubRewards rewards = DeClubRewards(payable(AT));

        vm.deal(OPERATOR, 6 ether);
        vm.prank(OPERATOR);
        rewards.publish{value: 6 ether}(4, ROOT);

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = 0xe92b6142bb576190a191c0299f86454dfb840fdd2794ba9ba6442081a7f3e48f;
        proof[1] = 0x950740596a524f91871784f2ed481a395825a7eab84ee027be51e687c3ea095e;
        rewards.claim(4, ALICE, 3 ether, proof);
        assertEq(ALICE.balance, 3 ether);
    }
}
