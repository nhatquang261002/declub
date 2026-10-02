// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IOnDeal} from "../src/interfaces/IOnDeal.sol";
import {OnDealBase} from "./utils/OnDealBase.sol";

contract OnDealCancelTest is OnDealBase {
    function test_cancel_returnsChogsAndMon() public {
        uint256 id = _create(alice, _ids(A1, A2), 2 ether, _ids(B1), 0);
        vm.prank(alice);
        swap.cancelTrade(id);

        _assertOwner(A1, alice);
        _assertOwner(A2, alice);
        assertEq(alice.balance, START_MON);
        assertEq(address(swap).balance, 0);
        assertEq(uint8(_status(id)), uint8(IOnDeal.Status.Cancelled));
    }

    function test_cancel_emitsTradeCancelled() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0);
        vm.expectEmit(address(swap));
        emit IOnDeal.TradeCancelled(id, alice);
        vm.prank(alice);
        swap.cancelTrade(id);
    }

    function test_cancel_worksAfterExpiry() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        uint256 id = _create(alice, _ids(A1), 1 ether, _ids(B1), 0, address(0), expiry);
        vm.warp(expiry + 1 days);
        vm.prank(alice);
        swap.cancelTrade(id);
        _assertOwner(A1, alice);
        assertEq(alice.balance, START_MON);
    }

    function test_cancel_keepsTermsForHistory() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 4 ether);
        vm.prank(alice);
        swap.cancelTrade(id);
        IOnDeal.Trade memory t = swap.getTrade(id);
        assertEq(t.offeredIds, _ids(A1));
        assertEq(t.requestedMon, 4 ether);
    }

    function test_cancel_revertsForNonMaker() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IOnDeal.NotMaker.selector, id));
        swap.cancelTrade(id);
    }

    function test_cancel_revertsForNamedTaker() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0, bob, 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IOnDeal.NotMaker.selector, id));
        swap.cancelTrade(id);
    }

    function test_cancel_revertsAfterFill() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0);
        _fill(bob, id);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IOnDeal.TradeNotOpen.selector, id));
        swap.cancelTrade(id);
    }

    function test_cancel_revertsTwice() public {
        uint256 id = _create(alice, _ids(A1), 1 ether, _ids(B1), 0);
        vm.startPrank(alice);
        swap.cancelTrade(id);
        vm.expectRevert(abi.encodeWithSelector(IOnDeal.TradeNotOpen.selector, id));
        swap.cancelTrade(id);
        vm.stopPrank();
        assertEq(alice.balance, START_MON);
    }

    function test_cancel_revertsUnknownTrade() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IOnDeal.TradeNotOpen.selector, 7));
        swap.cancelTrade(7);
    }
}
