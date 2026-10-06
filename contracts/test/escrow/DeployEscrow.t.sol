// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeClubEscrow} from "../../src/DeClubEscrow.sol";
import {IDeClubEscrow} from "../../src/interfaces/IDeClubEscrow.sol";
import {IFeeAdmin} from "../../src/interfaces/IFeeAdmin.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {DeployEscrow} from "../../script/DeployEscrow.s.sol";

contract DeployEscrowTest is Test {
    DeployEscrow internal script;

    function setUp() public {
        script = new DeployEscrow();
    }

    function test_deploysBareSwap() public {
        DeployEscrow.Config memory c;
        DeployEscrow.Result memory r = script.deploy(c);

        assertEq(DeClubEscrow(r.swap).tradeCount(), 0);
        assertEq(DeClubEscrow(r.swap).MAX_ASSETS_PER_SIDE(), 10);
        assertEq(r.mockErc20, address(0));
    }

    function test_deploysMockTokenAndMintsToDemoWallets() public {
        address a = makeAddr("a");
        address b = makeAddr("b");
        DeployEscrow.Config memory c;
        c.deployMockErc20 = true;
        c.mintAmount = 250;
        c.demoWallets = new address[](2);
        c.demoWallets[0] = a;
        c.demoWallets[1] = b;

        DeployEscrow.Result memory r = script.deploy(c);

        assertEq(MockERC20(r.mockErc20).balanceOf(a), 250 ether);
        assertEq(MockERC20(r.mockErc20).balanceOf(b), 250 ether);
    }

    function test_deploysWithTheFeeFromConfig() public {
        DeployEscrow.Config memory c;
        c.fee = 3 ether;
        c.maxFee = 12 ether;
        c.feeRecipient = makeAddr("treasury");
        c.feeAdmin = makeAddr("feeAdmin");
        DeployEscrow.Result memory r = script.deploy(c);

        assertEq(DeClubEscrow(r.swap).fee(), 3 ether);
        assertEq(DeClubEscrow(r.swap).MAX_FEE(), 12 ether);
        assertEq(DeClubEscrow(r.swap).FEE_RECIPIENT(), c.feeRecipient);
        assertEq(DeClubEscrow(r.swap).feeAdmin(), c.feeAdmin);
    }

    function test_refusesAFeeWithoutARecipient() public {
        DeployEscrow.Config memory c;
        c.fee = 1 ether;
        c.maxFee = 4 ether;
        c.feeAdmin = makeAddr("feeAdmin");
        vm.expectRevert(IFeeAdmin.NoFeeRecipient.selector);
        script.deploy(c);
    }

    function test_refusesOtherChains() public {
        vm.chainId(1);
        DeployEscrow.Config memory c;
        vm.expectRevert("unsupported chain");
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
        DeployEscrow.Config memory c = script.configFromEnv();
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
        DeployEscrow.Config memory c;
        c.fee = 1 ether;
        c.maxFee = 4 ether;
        c.feeRecipient = makeAddr("treasury");
        vm.expectRevert("FEE_ADMIN unset: set it, or FEE_FIXED=true to lock the fee for good");
        script.deploy(c);

        c.fixedFee = true;
        DeployEscrow.Result memory r = script.deploy(c);
        assertEq(DeClubEscrow(r.swap).feeAdmin(), address(0));
        assertEq(DeClubEscrow(r.swap).fee(), 1 ether);
    }

    function _mainnetConfig() internal returns (DeployEscrow.Config memory c) {
        vm.chainId(143);
        c.fee = 2 ether;
        c.maxFee = 8 ether;
        c.feeRecipient = makeAddr("recipientSafe");
        c.feeAdmin = makeAddr("adminSafe");
    }

    function test_mainnetDeploysWithAFeeAndTwoSafes() public {
        DeployEscrow.Config memory c = _mainnetConfig();
        DeployEscrow.Result memory r = script.deploy(c);
        assertEq(DeClubEscrow(r.swap).fee(), 2 ether);
        assertEq(DeClubEscrow(r.swap).feeAdmin(), c.feeAdmin);
    }

    function test_mainnetRefusesMocksAndDemoWallets() public {
        DeployEscrow.Config memory c = _mainnetConfig();
        c.deployMockErc20 = true;
        vm.expectRevert("mainnet: no mocks or demo wallets");
        script.deploy(c);

        c.deployMockErc20 = false;
        c.demoWallets = new address[](1);
        vm.expectRevert("mainnet: no mocks or demo wallets");
        script.deploy(c);
    }

    function test_mainnetRefusesDefaultsAndSharedKeys() public {
        DeployEscrow.Config memory c = _mainnetConfig();
        c.fee = 0;
        c.maxFee = 0;
        vm.expectRevert("mainnet: set PROTOCOL_FEE_WEI and PROTOCOL_FEE_MAX_WEI");
        script.deploy(c);

        c = _mainnetConfig();
        c.feeRecipient = address(0);
        vm.expectRevert("mainnet: set FEE_RECIPIENT (a Safe)");
        script.deploy(c);

        c = _mainnetConfig();
        c.feeAdmin = address(0);
        c.fixedFee = true;
        vm.expectRevert("mainnet: set FEE_ADMIN (a Safe), not FEE_FIXED");
        script.deploy(c);

        c = _mainnetConfig();
        c.feeAdmin = c.feeRecipient;
        vm.expectRevert("mainnet: FEE_ADMIN must differ from FEE_RECIPIENT");
        script.deploy(c);

        c = _mainnetConfig();
        c.fee = 9 ether;
        vm.expectRevert("mainnet: fee above its ceiling");
        script.deploy(c);
    }

    function test_refusesARecipientOrAdminWithoutACeiling() public {
        DeployEscrow.Config memory c;
        c.feeAdmin = makeAddr("feeAdmin");
        vm.expectRevert(
            "FEE_RECIPIENT/FEE_ADMIN set but PROTOCOL_FEE_MAX_WEI is 0: set the fee, or unset them"
        );
        script.deploy(c);

        c.feeAdmin = address(0);
        c.feeRecipient = makeAddr("treasury");
        vm.expectRevert(
            "FEE_RECIPIENT/FEE_ADMIN set but PROTOCOL_FEE_MAX_WEI is 0: set the fee, or unset them"
        );
        script.deploy(c);
    }
}
