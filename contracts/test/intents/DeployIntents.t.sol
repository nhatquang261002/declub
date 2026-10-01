// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogSwapIntents} from "../../src/ChogSwapIntents.sol";
import {DeployIntents} from "../../script/DeployIntents.s.sol";

contract DeployIntentsTest is Test {
    DeployIntents internal script;

    function setUp() public {
        script = new DeployIntents();
    }

    function test_deploysSwap() public {
        DeployIntents.Result memory r = script.deploy();

        assertEq(ChogSwapIntents(r.swap).MAX_CYCLE(), 4);
        assertEq(ChogSwapIntents(r.swap).MAX_ASSETS_PER_SIDE(), 10);
        assertEq(r.deployBlock, block.number);
    }

    function test_refusesOtherChains() public {
        vm.chainId(1);
        vm.expectRevert("testnet deployment only");
        script.deploy();
    }
}
