// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogSwapIntents} from "../../src/ChogSwapIntents.sol";
import {IChogSwapIntents} from "../../src/interfaces/IChogSwapIntents.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {DeployIntents} from "../../script/DeployIntents.s.sol";

contract DeployIntentsTest is Test {
    DeployIntents internal script;

    function setUp() public {
        script = new DeployIntents();
    }

    function test_deploysSwap() public {
        DeployIntents.Config memory c;
        DeployIntents.Result memory r = script.deploy(c);

        assertEq(ChogSwapIntents(r.swap).MAX_CYCLE(), 4);
        assertEq(ChogSwapIntents(r.swap).MAX_ASSETS_PER_SIDE(), 10);
        assertEq(ChogSwapIntents(r.swap).FEE_AMOUNT(), 0);
        assertEq(r.deployBlock, block.number);
    }

    function test_deploysWithTheFeeFromConfig() public {
        MockERC20 wmon = new MockERC20("Wrapped MON", "WMON");
        DeployIntents.Config memory c;
        c.feeToken = address(wmon);
        c.fee = 3 ether;
        c.feeRecipient = makeAddr("treasury");
        DeployIntents.Result memory r = script.deploy(c);

        assertEq(ChogSwapIntents(r.swap).FEE_TOKEN(), address(wmon));
        assertEq(ChogSwapIntents(r.swap).FEE_AMOUNT(), 3 ether);
        assertEq(ChogSwapIntents(r.swap).FEE_RECIPIENT(), c.feeRecipient);
    }

    function test_deploysAMockWmonAsTheFeeToken() public {
        DeployIntents.Config memory c;
        c.deployMockWmon = true;
        c.fee = 2 ether;
        c.feeRecipient = makeAddr("treasury");
        DeployIntents.Result memory r = script.deploy(c);

        assertTrue(r.mockWmon != address(0));
        assertEq(ChogSwapIntents(r.swap).FEE_TOKEN(), r.mockWmon);
    }

    function test_aGivenFeeTokenWinsOverTheMock() public {
        MockERC20 wmon = new MockERC20("Wrapped MON", "WMON");
        DeployIntents.Config memory c;
        c.deployMockWmon = true;
        c.feeToken = address(wmon);
        c.fee = 2 ether;
        c.feeRecipient = makeAddr("treasury");
        DeployIntents.Result memory r = script.deploy(c);

        assertEq(r.mockWmon, address(0));
        assertEq(ChogSwapIntents(r.swap).FEE_TOKEN(), address(wmon));
    }

    function test_refusesAFeeWithoutARecipient() public {
        MockERC20 wmon = new MockERC20("Wrapped MON", "WMON");
        DeployIntents.Config memory c;
        c.feeToken = address(wmon);
        c.fee = 1 ether;
        vm.expectRevert(IChogSwapIntents.NoFeeRecipient.selector);
        script.deploy(c);
    }

    function test_parsesTheFeeFromEnv() public {
        vm.setEnv("PROTOCOL_FEE_WEI", "2000000000000000000");
        vm.setEnv("FEE_TOKEN", "0x0000000000000000000000000000000000000abc");
        vm.setEnv("FEE_RECIPIENT", "0x0000000000000000000000000000000000000fee");
        vm.setEnv("DEPLOY_MOCK_WMON", "true");
        DeployIntents.Config memory c = script.configFromEnv();
        assertTrue(c.deployMockWmon);
        assertEq(c.fee, 2 ether);
        assertEq(c.feeToken, address(0xabc));
        assertEq(c.feeRecipient, address(0xfee));
    }

    function test_refusesOtherChains() public {
        vm.chainId(1);
        DeployIntents.Config memory c;
        vm.expectRevert("testnet deployment only");
        script.deploy(c);
    }
}
