// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IChogSwap} from "../src/interfaces/IChogSwap.sol";
import {ChogSwapBase} from "./utils/ChogSwapBase.sol";

contract ChogSwapReclaimTest is ChogSwapBase {
    uint64 internal expiry;
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        expiry = uint64(block.timestamp + 1 days);
        id = _create(alice, _ids(A1, A2), 3 ether, _ids(B1), 0, address(0), expiry);
    }

    function test_reclaim_anyoneRefundsMakerAfterExpiry() public {
        vm.warp(expiry + 1);
        assertTrue(swap.isExpired(id));

        uint256 carolBefore = carol.balance;
        vm.prank(carol);
        swap.reclaimExpired(id);

        _assertOwner(A1, alice);
        _assertOwner(A2, alice);
        assertEq(alice.balance, START_MON);
        assertEq(carol.balance, carolBefore, "caller must not receive anything");
        assertEq(address(swap).balance, 0);
        assertEq(uint8(_status(id)), uint8(IChogSwap.Status.Cancelled));
    }

    function test_reclaim_emitsTradeReclaimed() public {
        vm.warp(expiry + 1);
        vm.expectEmit(address(swap));
        emit IChogSwap.TradeReclaimed(id, alice, carol);
        vm.prank(carol);
        swap.reclaimExpired(id);
    }

    function test_reclaim_makerCanReclaimToo() public {
        vm.warp(expiry + 1);
        vm.prank(alice);
        swap.reclaimExpired(id);
        _assertOwner(A1, alice);
    }

    function test_reclaim_revertsBeforeExpiry() public {
        vm.warp(expiry); // boundary: not yet expired
        assertFalse(swap.isExpired(id));
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.TradeNotExpired.selector, id));
        swap.reclaimExpired(id);
    }

    function test_reclaim_revertsForNoExpiryTrade() public {
        uint256 forever = _create(bob, _ids(B1), 0, _ids(A3), 0);
        vm.warp(block.timestamp + 100 * 365 days);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.TradeNotExpired.selector, forever));
        swap.reclaimExpired(forever);
    }

    function test_reclaim_revertsTwice() public {
        vm.warp(expiry + 1);
        swap.reclaimExpired(id);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.TradeNotOpen.selector, id));
        swap.reclaimExpired(id);
    }

    function test_reclaim_revertsAfterFill() public {
        _fill(bob, id);
        vm.warp(expiry + 1);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.TradeNotOpen.selector, id));
        swap.reclaimExpired(id);
    }

    function test_reclaim_thenCancelReverts() public {
        vm.warp(expiry + 1);
        swap.reclaimExpired(id);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.TradeNotOpen.selector, id));
        swap.cancelTrade(id);
    }
}
