// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {OnDealIntents} from "../src/OnDealIntents.sol";
import {MockWMON} from "../src/mocks/MockWMON.sol";
import {FeeConfig} from "./FeeConfig.sol";

/// @notice Deploys OnDealIntents with its protocol fee (any token can be traded). It needs no
///         mock tokens: the existing mUSD and Chog collection from the other deployments work.
/// @dev The off-chain pool and matcher (../matcher) read the address from
///      NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS. OnDeal and OnDealV2 are untouched.
///      Env (all optional; the fee is off unless PROTOCOL_FEE_WEI is set):
///        PROTOCOL_FEE_WEI      fee per maker in `FEE_TOKEN` units (18 decimals)
///        PROTOCOL_FEE_MAX_WEI  ceiling the fee admin can never exceed, at most `MAX_FEE_LIMIT`;
///                              required when PROTOCOL_FEE_WEI is set (it is immutable)
///        FEE_TOKEN             the wrapped MON the fee is paid in; required when the ceiling
///                              is not 0 (unless DEPLOY_MOCK_WMON is set). The script wraps
///                              and unwraps 1 wei locally first and refuses anything that
///                              doesn't behave like WMON.
///        DEPLOY_MOCK_WMON      true → deploy a `MockWMON` and use it as the fee token (testnet
///                              has no canonical WMON). Ignored when FEE_TOKEN is set.
///        FEE_RECIPIENT         address that receives the fees; required when the ceiling is
///                              not 0
///        FEE_ADMIN             may change the fee within the ceiling; required when the
///                              ceiling is not 0, unless FEE_FIXED is set
///        FEE_FIXED             true → deploy with no fee admin, so the fee never changes
contract DeployIntents is Script {
    struct Config {
        bool deployMockWmon;
        address feeToken;
        uint256 fee;
        uint256 maxFee;
        address feeRecipient;
        address feeAdmin;
        bool fixedFee;
    }

    struct Result {
        address swap;
        address mockWmon;
        uint256 deployBlock;
    }

    function run() external returns (Result memory r) {
        r = deploy(configFromEnv());
        console.log("NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS=%s", r.swap);
        console.log("NEXT_PUBLIC_ON_DEAL_INTENTS_DEPLOY_BLOCK=%s", r.deployBlock);
        if (r.mockWmon != address(0)) console.log("MOCK_WMON_ADDRESS=%s", r.mockWmon);
        OnDealIntents swap = OnDealIntents(r.swap);
        console.log("fee token=%s", swap.FEE_TOKEN());
        console.log("protocol fee per maker (wei)=%s", swap.fee());
        console.log("fee ceiling (wei)=%s", swap.MAX_FEE());
        console.log("fee recipient=%s", swap.FEE_RECIPIENT());
        console.log("fee admin=%s", swap.feeAdmin());
    }

    function configFromEnv() public view returns (Config memory c) {
        c.fee = vm.envOr("PROTOCOL_FEE_WEI", uint256(0));
        c.maxFee = FeeConfig.maxFeeFromEnv(vm, c.fee);
        c.feeAdmin = vm.envOr("FEE_ADMIN", address(0));
        c.fixedFee = vm.envOr("FEE_FIXED", false);
        c.feeToken = vm.envOr("FEE_TOKEN", address(0));
        c.deployMockWmon = vm.envOr("DEPLOY_MOCK_WMON", false);
        c.feeRecipient = vm.envOr("FEE_RECIPIENT", address(0));
    }

    function deploy(Config memory c) public returns (Result memory r) {
        require(block.chainid == 10143 || block.chainid == 31337, "testnet deployment only");
        FeeConfig.checkAdmin(c.maxFee, c.feeAdmin, c.fixedFee);
        // Checked before broadcasting: the wrap and unwrap below never leave this machine.
        if (c.feeToken != address(0) && c.maxFee != 0) _checkWrappedNative(c.feeToken);
        r.deployBlock = block.number;
        vm.startBroadcast();
        address feeToken = c.feeToken;
        if (feeToken == address(0) && c.deployMockWmon) {
            r.mockWmon = address(new MockWMON());
            feeToken = r.mockWmon;
        }
        r.swap = address(new OnDealIntents(feeToken, c.fee, c.maxFee, c.feeRecipient, c.feeAdmin));
        vm.stopBroadcast();
    }

    /// @dev The fee token is immutable, so a typo or a look-alike token would be stuck for good.
    ///      Wrap 1 wei and unwrap it, as WETH9 does, and check 18 decimals. Runs only in the
    ///      local simulation: nothing here is broadcast.
    function _checkWrappedNative(address token) internal {
        require(token.code.length != 0, "FEE_TOKEN has no code");
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        require(
            ok && ret.length == 32 && abi.decode(ret, (uint256)) == 18, "FEE_TOKEN: not 18 decimals"
        );
        vm.deal(address(this), address(this).balance + 1);
        uint256 before = IWrappedNative(token).balanceOf(address(this));
        IWrappedNative(token).deposit{value: 1}();
        require(
            IWrappedNative(token).balanceOf(address(this)) == before + 1,
            "FEE_TOKEN: deposit didn't mint"
        );
        uint256 native = address(this).balance;
        IWrappedNative(token).withdraw(1);
        require(address(this).balance == native + 1, "FEE_TOKEN: withdraw didn't pay out");
    }

    receive() external payable {}
}

interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}
