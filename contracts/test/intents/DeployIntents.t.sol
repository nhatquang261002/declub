// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OnDealIntents} from "../../src/OnDealIntents.sol";
import {IOnDealIntents} from "../../src/interfaces/IOnDealIntents.sol";
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

        assertEq(OnDealIntents(r.swap).MAX_CYCLE(), 4);
        assertEq(OnDealIntents(r.swap).MAX_ASSETS_PER_SIDE(), 10);
        assertEq(OnDealIntents(r.swap).fee(), 0);
        assertEq(OnDealIntents(r.swap).feeAdmin(), address(0));
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

        assertEq(OnDealIntents(r.swap).FEE_TOKEN(), address(wmon));
        assertEq(OnDealIntents(r.swap).fee(), 3 ether);
        assertEq(OnDealIntents(r.swap).MAX_FEE(), 12 ether);
        assertEq(OnDealIntents(r.swap).FEE_RECIPIENT(), c.feeRecipient);
        assertEq(OnDealIntents(r.swap).feeAdmin(), c.feeAdmin);
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
        assertEq(OnDealIntents(r.swap).FEE_TOKEN(), r.mockWmon);
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
        assertEq(OnDealIntents(r.swap).FEE_TOKEN(), address(wmon));
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
        vm.expectRevert("testnet deployment only");
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
        assertEq(OnDealIntents(r.swap).feeAdmin(), address(0));
    }
}
