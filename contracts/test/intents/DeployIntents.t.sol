// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeClubIntents} from "../../src/DeClubIntents.sol";
import {IDeClubIntents} from "../../src/interfaces/IDeClubIntents.sol";
import {IFeeAdmin} from "../../src/interfaces/IFeeAdmin.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockWMON} from "../../src/mocks/MockWMON.sol";
import {DeployIntents} from "../../script/DeployIntents.s.sol";

contract DeployIntentsTest is Test {
    DeployIntents internal script;

    function setUp() public {
        script = new DeployIntents();
    }

    function test_deploysSwap() public {
        DeployIntents.Config memory c;
        DeployIntents.Result memory r = script.deploy(c);

        assertEq(DeClubIntents(r.swap).MAX_CYCLE(), 4);
        assertEq(DeClubIntents(r.swap).MAX_ASSETS_PER_SIDE(), 10);
        assertEq(DeClubIntents(r.swap).fee(), 0);
        assertEq(DeClubIntents(r.swap).feeAdmin(), address(0));
        assertEq(r.deployBlock, block.number);
    }

    function test_deploysWithTheFeeFromConfig() public {
        MockWMON wmon = new MockWMON();
        DeployIntents.Config memory c;
        c.feeToken = address(wmon);
        c.fee = 3 ether;
        c.maxFee = 12 ether;
        c.feeRecipient = makeAddr("treasury");
        c.feeAdmin = makeAddr("feeAdmin");
        DeployIntents.Result memory r = script.deploy(c);

        assertEq(DeClubIntents(r.swap).FEE_TOKEN(), address(wmon));
        assertEq(DeClubIntents(r.swap).fee(), 3 ether);
        assertEq(DeClubIntents(r.swap).MAX_FEE(), 12 ether);
        assertEq(DeClubIntents(r.swap).FEE_RECIPIENT(), c.feeRecipient);
        assertEq(DeClubIntents(r.swap).feeAdmin(), c.feeAdmin);
    }

    function test_deploysAMockWmonAsTheFeeToken() public {
        DeployIntents.Config memory c;
        c.deployMockWmon = true;
        c.fee = 2 ether;
        c.maxFee = 2 ether;
        c.feeRecipient = makeAddr("treasury");
        c.fixedFee = true;
        DeployIntents.Result memory r = script.deploy(c);

        assertTrue(r.mockWmon != address(0));
        assertEq(DeClubIntents(r.swap).FEE_TOKEN(), r.mockWmon);
    }

    function test_aGivenFeeTokenWinsOverTheMock() public {
        MockWMON wmon = new MockWMON();
        DeployIntents.Config memory c;
        c.deployMockWmon = true;
        c.feeToken = address(wmon);
        c.fee = 2 ether;
        c.maxFee = 2 ether;
        c.feeRecipient = makeAddr("treasury");
        c.fixedFee = true;
        DeployIntents.Result memory r = script.deploy(c);

        assertEq(r.mockWmon, address(0));
        assertEq(DeClubIntents(r.swap).FEE_TOKEN(), address(wmon));
    }

    function test_refusesAFeeWithoutARecipient() public {
        MockWMON wmon = new MockWMON();
        DeployIntents.Config memory c;
        c.feeToken = address(wmon);
        c.fee = 1 ether;
        c.maxFee = 1 ether;
        c.fixedFee = true;
        vm.expectRevert(IFeeAdmin.NoFeeRecipient.selector);
        script.deploy(c);
    }

    function test_parsesTheFeeFromEnv() public {
        vm.setEnv("PROTOCOL_FEE_WEI", "2000000000000000000");
        vm.setEnv("PROTOCOL_FEE_MAX_WEI", "8000000000000000000");
        vm.setEnv("FEE_TOKEN", "0x0000000000000000000000000000000000000abc");
        vm.setEnv("FEE_RECIPIENT", "0x0000000000000000000000000000000000000fee");
        vm.setEnv("DEPLOY_MOCK_WMON", "true");
        vm.setEnv("FEE_ADMIN", "0x0000000000000000000000000000000000000ad1");
        DeployIntents.Config memory c = script.configFromEnv();
        assertTrue(c.deployMockWmon);
        assertEq(c.fee, 2 ether);
        assertEq(c.maxFee, 8 ether);
        assertEq(c.feeAdmin, address(0xad1));
        assertEq(c.feeToken, address(0xabc));
        assertEq(c.feeRecipient, address(0xfee));
    }

    function test_refusesOtherChains() public {
        vm.chainId(1);
        DeployIntents.Config memory c;
        vm.expectRevert("unsupported chain");
        script.deploy(c);
    }

    function test_refusesAFeeTokenThatIsNotWrappedMon() public {
        DeployIntents.Config memory c;
        c.fee = 1 ether;
        c.maxFee = 1 ether;
        c.feeRecipient = makeAddr("treasury");
        c.feeAdmin = makeAddr("feeAdmin");

        c.feeToken = makeAddr("eoa");
        vm.expectRevert("FEE_TOKEN has no code");
        script.deploy(c);

        // A plain ERC-20 with 18 decimals has no deposit().
        c.feeToken = address(new MockERC20("Wrapped MON", "WMON"));
        vm.expectRevert();
        script.deploy(c);
    }

    function test_refusesAFeeWithNoAdminUnlessFixed() public {
        DeployIntents.Config memory c;
        c.feeToken = address(new MockWMON());
        c.fee = 1 ether;
        c.maxFee = 1 ether;
        c.feeRecipient = makeAddr("treasury");
        vm.expectRevert("FEE_ADMIN unset: set it, or FEE_FIXED=true to lock the fee for good");
        script.deploy(c);

        c.fixedFee = true;
        DeployIntents.Result memory r = script.deploy(c);
        assertEq(DeClubIntents(r.swap).feeAdmin(), address(0));
    }

    function _mainnetConfig() internal returns (DeployIntents.Config memory c) {
        vm.chainId(143);
        // Stand in for the canonical WMON, which a plain test chain doesn't have.
        vm.etch(0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A, address(new MockWMON()).code);
        c.feeToken = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
        c.fee = 2 ether;
        c.maxFee = 8 ether;
        c.feeRecipient = makeAddr("recipientSafe");
        c.feeAdmin = makeAddr("adminSafe");
    }

    function test_mainnetDeploysWithTheCanonicalWmon() public {
        DeployIntents.Config memory c = _mainnetConfig();
        DeployIntents.Result memory r = script.deploy(c);
        assertEq(DeClubIntents(r.swap).FEE_TOKEN(), c.feeToken);
        assertEq(DeClubIntents(r.swap).feeAdmin(), c.feeAdmin);
        assertEq(r.mockWmon, address(0));
    }

    function test_mainnetRefusesMockOrOtherFeeTokens() public {
        DeployIntents.Config memory c = _mainnetConfig();
        c.deployMockWmon = true;
        vm.expectRevert("mainnet: no mock WMON");
        script.deploy(c);

        c.deployMockWmon = false;
        c.feeToken = address(new MockWMON()); // behaves like WMON, but isn't the canonical one
        vm.expectRevert("mainnet: FEE_TOKEN must be the canonical WMON");
        script.deploy(c);

        c.feeToken = address(0);
        vm.expectRevert("mainnet: FEE_TOKEN must be the canonical WMON");
        script.deploy(c);
    }

    function test_mainnetRefusesDefaultsAndSharedKeys() public {
        DeployIntents.Config memory c = _mainnetConfig();
        c.feeAdmin = c.feeRecipient;
        vm.expectRevert("mainnet: FEE_ADMIN must differ from FEE_RECIPIENT");
        script.deploy(c);

        c = _mainnetConfig();
        c.feeAdmin = address(0);
        c.fixedFee = true;
        vm.expectRevert("mainnet: set FEE_ADMIN (a Safe), not FEE_FIXED");
        script.deploy(c);

        c = _mainnetConfig();
        c.fee = 0;
        c.maxFee = 0;
        vm.expectRevert("mainnet: set PROTOCOL_FEE_WEI and PROTOCOL_FEE_MAX_WEI");
        script.deploy(c);
    }

    function test_refusesARecipientOrAdminWithoutACeiling() public {
        DeployIntents.Config memory c;
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
