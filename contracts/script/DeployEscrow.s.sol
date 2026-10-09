// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {DeClubEscrow} from "../src/DeClubEscrow.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {FeeConfig} from "./FeeConfig.sol";

/// @notice Deploys the generic DeClubEscrow (any token) with its protocol fee, and optionally a
///         mock ERC-20 so the multi-asset flow can be demoed on testnet.
/// @dev Env (all optional):
///        PROTOCOL_FEE_WEI      per-side fee in wei (default 0 = no fee)
///        PROTOCOL_FEE_MAX_WEI  ceiling the fee admin can never exceed, at most `MAX_FEE_LIMIT`;
///                              required when PROTOCOL_FEE_WEI is set (it is immutable)
///        FEE_RECIPIENT         address that receives the fees; required when the ceiling is
///                              not 0
///        FEE_ADMIN             may change the fee within the ceiling; required when the
///                              ceiling is not 0, unless FEE_FIXED is set
///        FEE_FIXED             true → deploy with no fee admin, so the fee never changes
///        DEPLOY_MOCK_ERC20  true → also deploy "Mock USD" (mUSD) with an open mint
///        DEMO_WALLETS       comma-separated addresses to mint mUSD to
///        DEMO_MINT_AMOUNT   mUSD (whole tokens) per demo wallet (default 1000)
///      DeClubIntents is deployed separately (DeployIntents.s.sol) and independent of this contract.
contract DeployEscrow is Script {
    struct Config {
        uint256 fee;
        uint256 maxFee;
        address feeRecipient;
        address feeAdmin;
        bool fixedFee;
        bool deployMockErc20;
        address[] demoWallets;
        uint256 mintAmount; // whole tokens
    }

    struct Result {
        address swap;
        address mockErc20;
        uint256 deployBlock;
    }

    function run() external returns (Result memory r) {
        r = deploy(configFromEnv());
        console.log("NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS=%s", r.swap);
        console.log("NEXT_PUBLIC_DECLUB_ESCROW_DEPLOY_BLOCK=%s", r.deployBlock);
        DeClubEscrow swap = DeClubEscrow(r.swap);
        console.log("protocol fee per side (wei)=%s", swap.fee());
        console.log("fee ceiling (wei)=%s", swap.MAX_FEE());
        console.log("fee recipient=%s", swap.FEE_RECIPIENT());
        console.log("fee admin=%s", swap.feeAdmin());
        if (r.mockErc20 != address(0)) {
            console.log("NEXT_PUBLIC_MOCK_ERC20_ADDRESS=%s", r.mockErc20);
        }
    }

    function configFromEnv() public view returns (Config memory c) {
        c.fee = vm.envOr("PROTOCOL_FEE_WEI", uint256(0));
        c.maxFee = FeeConfig.maxFeeFromEnv(vm, c.fee);
        c.feeRecipient = vm.envOr("FEE_RECIPIENT", address(0));
        c.feeAdmin = vm.envOr("FEE_ADMIN", address(0));
        c.fixedFee = vm.envOr("FEE_FIXED", false);
        c.deployMockErc20 = vm.envOr("DEPLOY_MOCK_ERC20", false);
        c.mintAmount = vm.envOr("DEMO_MINT_AMOUNT", uint256(1000));
        string memory wallets = vm.trim(vm.envOr("DEMO_WALLETS", string("")));
        if (bytes(wallets).length != 0) {
            string[] memory parts = vm.split(wallets, ",");
            c.demoWallets = new address[](parts.length);
            for (uint256 i; i < parts.length; ++i) {
                c.demoWallets[i] = vm.parseAddress(vm.trim(parts[i]));
            }
        }
    }

    function deploy(Config memory c) public returns (Result memory r) {
        bool mainnet = FeeConfig.requireSupportedChain();
        if (mainnet) {
            require(
                !c.deployMockErc20 && c.demoWallets.length == 0, "mainnet: no mocks or demo wallets"
            );
            FeeConfig.checkMainnet(c.fee, c.maxFee, c.feeRecipient, c.feeAdmin, c.fixedFee);
        }
        FeeConfig.checkConsistent(c.maxFee, c.feeRecipient, c.feeAdmin);
        FeeConfig.checkAdmin(c.maxFee, c.feeAdmin, c.fixedFee);
        r.deployBlock = block.number;
        vm.startBroadcast();

        r.swap = address(new DeClubEscrow(c.fee, c.maxFee, c.feeRecipient, c.feeAdmin));
        if (c.deployMockErc20) {
            MockERC20 token = new MockERC20("Mock USD", "mUSD");
            r.mockErc20 = address(token);
            for (uint256 i; i < c.demoWallets.length; ++i) {
                token.mint(c.demoWallets[i], c.mintAmount * 1 ether);
            }
        }

        vm.stopBroadcast();
    }
}
