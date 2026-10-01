// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ChogSwapIntents} from "../src/ChogSwapIntents.sol";

/// @notice Deploys ChogSwapIntents (no constructor args, any token). It needs no mock tokens:
///         the existing mUSD and Chog collection from the other deployments work with it.
/// @dev The off-chain pool and matcher (../matcher) read the address from
///      NEXT_PUBLIC_CHOG_SWAP_INTENTS_ADDRESS. ChogSwap and ChogSwapV2 are untouched.
contract DeployIntents is Script {
    struct Result {
        address swap;
        uint256 deployBlock;
    }

    function run() external returns (Result memory r) {
        r = deploy();
        console.log("NEXT_PUBLIC_CHOG_SWAP_INTENTS_ADDRESS=%s", r.swap);
        console.log("NEXT_PUBLIC_CHOG_SWAP_INTENTS_DEPLOY_BLOCK=%s", r.deployBlock);
    }

    function deploy() public returns (Result memory r) {
        require(block.chainid == 10143 || block.chainid == 31337, "testnet deployment only");
        r.deployBlock = block.number;
        vm.startBroadcast();
        r.swap = address(new ChogSwapIntents());
        vm.stopBroadcast();
    }
}
