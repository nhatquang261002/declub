// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeClubRewards} from "../../src/DeClubRewards.sol";
import {IDeClubRewards} from "../../src/interfaces/IDeClubRewards.sol";
import {DeployRewards} from "../../script/DeployRewards.s.sol";

/// @dev A contract stands in for the operator Safe on mainnet.
contract FakeSafe {}

contract DeployRewardsTest is Test {
    DeployRewards internal script;
    address internal operator = makeAddr("operator");

    function setUp() public {
        script = new DeployRewards();
    }

    function test_deploysWithTheConfig() public {
        DeployRewards.Result memory r = script.deploy(DeployRewards.Config(operator, 0, 30 days));
        DeClubRewards rewards = DeClubRewards(r.rewards);
        assertEq(rewards.operator(), operator);
        assertEq(rewards.CLAIM_DELAY(), 0);
        assertEq(rewards.CLAIM_WINDOW(), 30 days);
        assertEq(r.deployBlock, block.number);
    }

    function test_readsTheEnvWithDefaults() public {
        vm.setEnv("REWARDS_OPERATOR", "0x0000000000000000000000000000000000000a11");
        DeployRewards.Config memory c = script.configFromEnv();
        assertEq(c.operator, address(0xa11));
        assertEq(c.claimDelay, 1 days);
        assertEq(c.claimWindow, 90 days);

        vm.setEnv("REWARDS_CLAIM_DELAY", "0");
        vm.setEnv("REWARDS_CLAIM_WINDOW", "86400");
        c = script.configFromEnv();
        assertEq(c.claimDelay, 0);
        assertEq(c.claimWindow, 1 days);
    }

    function test_requiresAnOperator() public {
        vm.expectRevert("REWARDS_OPERATOR is required");
        script.deploy(DeployRewards.Config(address(0), 1 days, 90 days));
    }

    function test_passesTheContractsOwnTimingChecks() public {
        vm.expectRevert(abi.encodeWithSelector(IDeClubRewards.BadTiming.selector, 8 days, 90 days));
        script.deploy(DeployRewards.Config(operator, 8 days, 90 days));
    }

    function test_refusesAnUnsupportedChain() public {
        vm.chainId(1);
        vm.expectRevert("unsupported chain");
        script.deploy(DeployRewards.Config(operator, 1 days, 90 days));
    }

    function test_mainnetWantsASafeAndARealDelay() public {
        vm.chainId(143);
        vm.expectRevert("mainnet: REWARDS_OPERATOR must be a Safe");
        script.deploy(DeployRewards.Config(operator, 1 days, 90 days));

        address safe = address(new FakeSafe());
        vm.expectRevert("mainnet: REWARDS_CLAIM_DELAY must be at least 1 day");
        script.deploy(DeployRewards.Config(safe, 1 days - 1, 90 days));

        DeployRewards.Result memory r = script.deploy(DeployRewards.Config(safe, 1 days, 90 days));
        assertEq(DeClubRewards(r.rewards).operator(), safe);
    }
}
