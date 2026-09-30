// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

contract MockERC20Test is Test {
    MockERC20 internal token = new MockERC20("Mock USD", "mUSD");

    function test_mintsToAnyone() public {
        token.mint(address(this), 5 ether);
        assertEq(token.balanceOf(address(this)), 5 ether);
    }

    function test_revertsOnZeroOrHugeMint() public {
        vm.expectRevert(abi.encodeWithSelector(MockERC20.InvalidAmount.selector, 0));
        token.mint(address(this), 0);
        uint256 tooMuch = token.MAX_MINT_PER_TX() + 1;
        vm.expectRevert(abi.encodeWithSelector(MockERC20.InvalidAmount.selector, tooMuch));
        token.mint(address(this), tooMuch);
    }
}
