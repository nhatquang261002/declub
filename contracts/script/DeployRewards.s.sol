// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {DeClubRewards} from "../src/DeClubRewards.sol";
import {FeeConfig} from "./FeeConfig.sol";

/// @notice Deploys DeClubRewards, the Merkle distributor for Club rewards
///         (docs/adr/0022-club-rewards.md). It touches neither deal contract.
/// @dev Env:
///        REWARDS_OPERATOR      publishes, revokes and sweeps epochs (required). On mainnet it
///                              must be a contract (a Safe), not a hot key.
///        REWARDS_CLAIM_DELAY   seconds a root waits before claims open, so a wrong one can be
///                              revoked (default 1 day; at least 1 day on mainnet; 0 for demos)
///        REWARDS_CLAIM_WINDOW  seconds claims stay open before the rest can be swept
///                              (default 90 days)
contract DeployRewards is Script {
    uint256 internal constant DEFAULT_DELAY = 1 days;
    uint256 internal constant DEFAULT_WINDOW = 90 days;

    struct Config {
        address operator;
        uint256 claimDelay;
        uint256 claimWindow;
    }

    struct Result {
        address rewards;
        uint256 deployBlock;
    }

    function run() external returns (Result memory r) {
        r = deploy(configFromEnv());
        DeClubRewards rewards = DeClubRewards(r.rewards);
        console.log("NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS=%s", r.rewards);
        console.log("NEXT_PUBLIC_DECLUB_REWARDS_DEPLOY_BLOCK=%s", r.deployBlock);
        console.log("operator=%s", rewards.operator());
        console.log("claim delay (s)=%s", rewards.CLAIM_DELAY());
        console.log("claim window (s)=%s", rewards.CLAIM_WINDOW());
    }

    function configFromEnv() public view returns (Config memory c) {
        c.operator = vm.envOr("REWARDS_OPERATOR", address(0));
        c.claimDelay = vm.envOr("REWARDS_CLAIM_DELAY", DEFAULT_DELAY);
        c.claimWindow = vm.envOr("REWARDS_CLAIM_WINDOW", DEFAULT_WINDOW);
    }

    function deploy(Config memory c) public returns (Result memory r) {
        bool mainnet = FeeConfig.requireSupportedChain();
        require(c.operator != address(0), "REWARDS_OPERATOR is required");
        if (mainnet) {
            require(c.operator.code.length != 0, "mainnet: REWARDS_OPERATOR must be a Safe");
            require(c.claimDelay >= 1 days, "mainnet: REWARDS_CLAIM_DELAY must be at least 1 day");
        }
        r.deployBlock = block.number;
        vm.startBroadcast();
        r.rewards = address(new DeClubRewards(c.operator, c.claimDelay, c.claimWindow));
        vm.stopBroadcast();
    }
}
