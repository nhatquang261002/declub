// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockWMON} from "../src/mocks/MockWMON.sol";
import {MonReceiver} from "./utils/Actors.sol";

contract MockWMONTest is Test {
    MockWMON internal wmon = new MockWMON();
    address internal alice = makeAddr("alice");

    function test_depositWrapsOneToOne() public {
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        wmon.deposit{value: 3 ether}();
        assertEq(wmon.balanceOf(alice), 3 ether);
        assertEq(address(wmon).balance, 3 ether);
        assertEq(alice.balance, 2 ether);
    }

    function test_plainTransferAlsoWraps() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(wmon).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(wmon.balanceOf(alice), 1 ether);
    }

    function test_withdrawUnwraps() public {
        vm.deal(alice, 2 ether);
        vm.startPrank(alice);
        wmon.deposit{value: 2 ether}();
        wmon.withdraw(1.5 ether);
        vm.stopPrank();
        assertEq(wmon.balanceOf(alice), 0.5 ether);
        assertEq(alice.balance, 1.5 ether);
    }

    function test_withdrawMoreThanHeldReverts() public {
        vm.prank(alice);
        vm.expectRevert();
        wmon.withdraw(1);
    }

    function test_withdrawToAContractThatRejectsMonReverts() public {
        MonReceiver picky = new MonReceiver();
        vm.deal(address(picky), 1 ether);
        vm.prank(address(picky));
        wmon.deposit{value: 1 ether}();
        vm.prank(address(picky));
        vm.expectRevert(MockWMON.WithdrawFailed.selector);
        wmon.withdraw(1 ether);
    }
}
