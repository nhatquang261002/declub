// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IChogSwapV2} from "../../src/interfaces/IChogSwapV2.sol";
import {ChogSwapV2Base} from "./ChogSwapV2Base.sol";

contract ChogSwapV2CancelTest is ChogSwapV2Base {
    function _bundle() internal returns (uint256) {
        return _create(
            alice,
            _list(_chog(A1), _erc20(address(usdc), 40 ether), _native(2 ether)),
            _list(_chog(B1))
        );
    }

    function _assertRefunded() internal view {
        _assertOwner(A1, alice);
        assertEq(usdc.balanceOf(alice), START_TOKEN);
        assertEq(alice.balance, START_MON);
        assertEq(usdc.balanceOf(address(swap)), 0);
        assertEq(address(swap).balance, 0);
    }

    // ───────────────────────────────────────────── cancel

    function test_makerCancelsAndGetsEverythingBack() public {
        uint256 id = _bundle();
        vm.expectEmit(true, true, false, true, address(swap));
        emit IChogSwapV2.TradeCancelled(id, alice);
        vm.prank(alice);
        swap.cancelTrade(id);

        _assertRefunded();
        assertEq(uint8(_status(id)), uint8(IChogSwapV2.Status.Cancelled));
    }

    function test_cancelWorksAfterExpiry() public {
        uint256 id = _create(
            alice, _list(_chog(A1)), _list(_chog(B1)), address(0), uint64(block.timestamp + 1)
        );
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        swap.cancelTrade(id);
        _assertOwner(A1, alice);
    }

    function test_cancelRevertsForNonMaker() public {
        uint256 id = _bundle();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IChogSwapV2.NotMaker.selector, id));
        swap.cancelTrade(id);
    }

    function test_cancelRevertsAfterFillCancelOrUnknown() public {
        uint256 filled = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        _fill(bob, filled);
        uint256 cancelled = _create(alice, _list(_chog(A2)), _list(_chog(B2)));
        vm.startPrank(alice);
        swap.cancelTrade(cancelled);

        vm.expectRevert(abi.encodeWithSelector(IChogSwapV2.TradeNotOpen.selector, filled));
        swap.cancelTrade(filled);
        vm.expectRevert(abi.encodeWithSelector(IChogSwapV2.TradeNotOpen.selector, cancelled));
        swap.cancelTrade(cancelled);
        vm.expectRevert(abi.encodeWithSelector(IChogSwapV2.TradeNotOpen.selector, 42));
        swap.cancelTrade(42);
        vm.stopPrank();
    }

    function test_cannotFillCancelled() public {
        uint256 id = _bundle();
        vm.prank(alice);
        swap.cancelTrade(id);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IChogSwapV2.TradeNotOpen.selector, id));
        swap.fillTrade(id);
    }

    // ───────────────────────────────────────────── reclaim

    function test_anyoneReclaimsToTheMaker() public {
        uint256 id = _create(
            alice,
            _list(_chog(A1), _erc20(address(usdc), 40 ether), _native(2 ether)),
            _list(_chog(B1)),
            address(0),
            uint64(block.timestamp + 1 hours)
        );
        vm.warp(block.timestamp + 1 hours + 1);

        vm.expectEmit(true, true, true, true, address(swap));
        emit IChogSwapV2.TradeReclaimed(id, alice, carol);
        vm.prank(carol);
        swap.reclaimExpired(id);

        _assertRefunded();
        assertEq(carol.balance, START_MON);
        assertEq(usdc.balanceOf(carol), START_TOKEN);
        assertEq(uint8(_status(id)), uint8(IChogSwapV2.Status.Cancelled));
    }

    function test_reclaimRevertsBeforeExpiryAndForNoExpiry() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        uint256 timed = _create(alice, _list(_chog(A1)), _list(_chog(B1)), address(0), expiry);
        uint256 forever = _create(alice, _list(_chog(A2)), _list(_chog(B2)));

        vm.warp(expiry); // boundary: not expired yet
        vm.expectRevert(abi.encodeWithSelector(IChogSwapV2.TradeNotExpired.selector, timed));
        swap.reclaimExpired(timed);

        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(abi.encodeWithSelector(IChogSwapV2.TradeNotExpired.selector, forever));
        swap.reclaimExpired(forever);
    }

    function test_reclaimRevertsWhenNotOpen() public {
        uint256 id = _create(
            alice, _list(_chog(A1)), _list(_chog(B1)), address(0), uint64(block.timestamp + 1)
        );
        _fill(bob, id);
        vm.warp(block.timestamp + 10);
        vm.expectRevert(abi.encodeWithSelector(IChogSwapV2.TradeNotOpen.selector, id));
        swap.reclaimExpired(id);
    }
}
