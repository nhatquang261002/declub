// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {OnDeal} from "../src/OnDeal.sol";
import {MockChog} from "../src/mocks/MockChog.sol";

/// @dev Calls `deploy(Config)` directly: env vars are process-wide and tests run in parallel.
contract DeployScriptTest is Test {
    Deploy internal script;

    function setUp() public {
        script = new Deploy();
    }

    function test_deploysMockAndMintsToDemoWallets() public {
        address a = makeAddr("demoA");
        address b = makeAddr("demoB");
        address[] memory wallets = new address[](2);
        (wallets[0], wallets[1]) = (a, b);

        Deploy.Result memory r = script.deploy(Deploy.Config(address(0), wallets, 3, false, address(0), 20));

        assertTrue(r.deployedMock);
        assertFalse(r.deployedMirror);
        assertEq(OnDeal(r.swap).chog(), r.chog);
        assertEq(MockChog(r.chog).balanceOf(a), 3);
        assertEq(MockChog(r.chog).balanceOf(b), 3);
    }

    function test_deploysMockWithoutDemoWallets() public {
        Deploy.Result memory r = script.deploy(Deploy.Config(address(0), new address[](0), 5, false, address(0), 20));
        assertTrue(r.deployedMock);
        assertFalse(r.deployedMirror);
        assertEq(MockChog(r.chog).totalSupply(), 0);
    }

    function test_usesExistingCollection() public {
        MockChog existing = new MockChog();
        Deploy.Result memory r =
            script.deploy(Deploy.Config(address(existing), new address[](0), 5, false, address(0), 20));

        assertFalse(r.deployedMock);
        assertFalse(r.deployedMirror);
        assertEq(r.chog, address(existing));
        assertEq(OnDeal(r.swap).chog(), address(existing));
    }

    function test_parseAddresses() public {
        address a = makeAddr("demoA");
        address b = makeAddr("demoB");
        address[] memory out =
            script.parseAddresses(string.concat(" ", vm.toString(a), " , ", vm.toString(b), " "));
        assertEq(out.length, 2);
        assertEq(out[0], a);
        assertEq(out[1], b);

        assertEq(script.parseAddresses("").length, 0);
        assertEq(script.parseAddresses("   ").length, 0);
    }
}
