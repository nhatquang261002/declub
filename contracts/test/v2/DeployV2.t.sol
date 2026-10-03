// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OnDealV2} from "../../src/OnDealV2.sol";
import {IOnDealV2} from "../../src/interfaces/IOnDealV2.sol";
import {IFeeAdmin} from "../../src/interfaces/IFeeAdmin.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {DeployV2} from "../../script/DeployV2.s.sol";

contract DeployV2Test is Test {
    DeployV2 internal script;

    function setUp() public {
        script = new DeployV2();
    }

    function test_deploysBareSwap() public {
        DeployV2.Config memory c;
        DeployV2.Result memory r = script.deploy(c);

        assertEq(OnDealV2(r.swap).tradeCount(), 0);
        assertEq(OnDealV2(r.swap).MAX_ASSETS_PER_SIDE(), 10);
        assertEq(r.mockErc20, address(0));
    }

    function test_deploysMockTokenAndMintsToDemoWallets() public {
        address a = makeAddr("a");
        address b = makeAddr("b");
        DeployV2.Config memory c;
        c.deployMockErc20 = true;
        c.mintAmount = 250;
        c.demoWallets = new address[](2);
        c.demoWallets[0] = a;
        c.demoWallets[1] = b;

        DeployV2.Result memory r = script.deploy(c);

        assertEq(MockERC20(r.mockErc20).balanceOf(a), 250 ether);
        assertEq(MockERC20(r.mockErc20).balanceOf(b), 250 ether);
    }

    function test_deploysWithTheFeeFromConfig() public {
        DeployV2.Config memory c;
        c.fee = 3 ether;
        c.maxFee = 12 ether;
        c.feeRecipient = makeAddr("treasury");
        c.feeAdmin = makeAddr("feeAdmin");
        DeployV2.Result memory r = script.deploy(c);

        assertEq(OnDealV2(r.swap).fee(), 3 ether);
        assertEq(OnDealV2(r.swap).MAX_FEE(), 12 ether);
        assertEq(OnDealV2(r.swap).FEE_RECIPIENT(), c.feeRecipient);
        assertEq(OnDealV2(r.swap).feeAdmin(), c.feeAdmin);
    }

    function test_refusesAFeeWithoutARecipient() public {
        DeployV2.Config memory c;
        c.fee = 1 ether;
        c.maxFee = 4 ether;
        c.feeAdmin = makeAddr("feeAdmin");
        vm.expectRevert(IFeeAdmin.NoFeeRecipient.selector);
        script.deploy(c);
    }

    function test_refusesOtherChains() public {
        vm.chainId(1);
        DeployV2.Config memory c;
        vm.expectRevert("testnet deployment only");
        script.deploy(c);
    }

    function test_parsesEnvWallets() public {
        vm.setEnv("DEPLOY_MOCK_ERC20", "true");
        vm.setEnv(
            "DEMO_WALLETS",
            " 0x0000000000000000000000000000000000000abc , 0x0000000000000000000000000000000000000def"
        );
        vm.setEnv("DEMO_MINT_AMOUNT", "5");
        vm.setEnv("PROTOCOL_FEE_WEI", "2000000000000000000");
        vm.setEnv("PROTOCOL_FEE_MAX_WEI", "8000000000000000000");
        vm.setEnv("FEE_RECIPIENT", "0x0000000000000000000000000000000000000fee");
        vm.setEnv("FEE_ADMIN", "0x0000000000000000000000000000000000000ad1");
        DeployV2.Config memory c = script.configFromEnv();
        assertEq(c.fee, 2 ether);
        assertEq(c.maxFee, 8 ether);
        assertEq(c.feeRecipient, address(0xfee));
        assertEq(c.feeAdmin, address(0xad1));
        assertTrue(c.deployMockErc20);
        assertEq(c.demoWallets.length, 2);
        assertEq(c.demoWallets[1], address(0xdef));
        assertEq(c.mintAmount, 5);
    }

    function test_refusesAFeeWithoutACeiling() public {
        vm.setEnv("PROTOCOL_FEE_WEI", "1");
        vm.setEnv("PROTOCOL_FEE_MAX_WEI", ""); // empty counts as unset
        vm.expectRevert("PROTOCOL_FEE_MAX_WEI is required when PROTOCOL_FEE_WEI is set");
        script.configFromEnv();
    }

    function test_refusesAFeeWithNoAdminUnlessFixed() public {
        DeployV2.Config memory c;
        c.fee = 1 ether;
        c.maxFee = 4 ether;
        c.feeRecipient = makeAddr("treasury");
        vm.expectRevert("FEE_ADMIN unset: set it, or FEE_FIXED=true to lock the fee for good");
        script.deploy(c);

        c.fixedFee = true;
        DeployV2.Result memory r = script.deploy(c);
        assertEq(OnDealV2(r.swap).feeAdmin(), address(0));
        assertEq(OnDealV2(r.swap).fee(), 1 ether);
    }
}
