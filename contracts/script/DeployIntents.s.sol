// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ChogSwapIntents} from "../src/ChogSwapIntents.sol";
import {MockWMON} from "../src/mocks/MockWMON.sol";

/// @notice Deploys ChogSwapIntents with its protocol fee (any token can be traded). It needs no
///         mock tokens: the existing mUSD and Chog collection from the other deployments work.
/// @dev The off-chain pool and matcher (../matcher) read the address from
///      NEXT_PUBLIC_CHOG_SWAP_INTENTS_ADDRESS. ChogSwap and ChogSwapV2 are untouched.
///      Env (all optional; the fee is off unless PROTOCOL_FEE_WEI is set):
///        PROTOCOL_FEE_WEI  fee per maker in `FEE_TOKEN` units (18 decimals), at most `MAX_FEE`
///        FEE_TOKEN         the wrapped MON the fee is paid in; required when the fee is not 0
///                          (unless DEPLOY_MOCK_WMON is set)
///        DEPLOY_MOCK_WMON  true → deploy a `MockWMON` and use it as the fee token (testnet has
///                          no canonical WMON). Ignored when FEE_TOKEN is set.
///        FEE_RECIPIENT     address that receives the fees; required when the fee is not 0
contract DeployIntents is Script {
    struct Config {
        bool deployMockWmon;
        address feeToken;
        uint256 fee;
        address feeRecipient;
    }

    struct Result {
        address swap;
        address mockWmon;
        uint256 deployBlock;
    }

    function run() external returns (Result memory r) {
        r = deploy(configFromEnv());
        console.log("NEXT_PUBLIC_CHOG_SWAP_INTENTS_ADDRESS=%s", r.swap);
        console.log("NEXT_PUBLIC_CHOG_SWAP_INTENTS_DEPLOY_BLOCK=%s", r.deployBlock);
        if (r.mockWmon != address(0)) console.log("MOCK_WMON_ADDRESS=%s", r.mockWmon);
        console.log("fee token=%s", ChogSwapIntents(r.swap).FEE_TOKEN());
        console.log("protocol fee per maker (wei)=%s", ChogSwapIntents(r.swap).FEE_AMOUNT());
        console.log("fee recipient=%s", ChogSwapIntents(r.swap).FEE_RECIPIENT());
    }

    function configFromEnv() public view returns (Config memory c) {
        c.fee = vm.envOr("PROTOCOL_FEE_WEI", uint256(0));
        c.feeToken = vm.envOr("FEE_TOKEN", address(0));
        c.deployMockWmon = vm.envOr("DEPLOY_MOCK_WMON", false);
        c.feeRecipient = vm.envOr("FEE_RECIPIENT", address(0));
    }

    function deploy(Config memory c) public returns (Result memory r) {
        require(block.chainid == 10143 || block.chainid == 31337, "testnet deployment only");
        r.deployBlock = block.number;
        vm.startBroadcast();
        address feeToken = c.feeToken;
        if (feeToken == address(0) && c.deployMockWmon) {
            r.mockWmon = address(new MockWMON());
            feeToken = r.mockWmon;
        }
        r.swap = address(new ChogSwapIntents(feeToken, c.fee, c.feeRecipient));
        vm.stopBroadcast();
    }
}
