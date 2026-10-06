// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IDeClubEscrow} from "../../src/interfaces/IDeClubEscrow.sol";
import {DeClubEscrowBase} from "./DeClubEscrowBase.sol";

contract DeClubEscrowFuzzTest is DeClubEscrowBase {
    /// Whatever the amounts, a fill moves exactly the listed assets and leaves nothing behind.
    function testFuzz_fillConservesEverything(
        uint96 offeredMon,
        uint96 offeredUsdc,
        uint96 requestedWeth
    ) public {
        offeredMon = uint96(bound(offeredMon, 1, START_MON));
        offeredUsdc = uint96(bound(offeredUsdc, 1, START_TOKEN));
        requestedWeth = uint96(bound(requestedWeth, 1, START_TOKEN));

        uint256 id = _create(
            alice,
            _list(_chog(A1), _erc20(address(usdc), offeredUsdc), _native(offeredMon)),
            _list(_erc20(address(weth), requestedWeth), _chog(B1))
        );
        _fill(bob, id);

        _assertOwner(A1, bob);
        _assertOwner(B1, alice);
        assertEq(usdc.balanceOf(bob), START_TOKEN + offeredUsdc);
        assertEq(usdc.balanceOf(alice), START_TOKEN - offeredUsdc);
        assertEq(weth.balanceOf(alice), START_TOKEN + requestedWeth);
        assertEq(weth.balanceOf(bob), START_TOKEN - requestedWeth);
        assertEq(bob.balance, START_MON + offeredMon);
        assertEq(alice.balance, START_MON - offeredMon);
        assertEq(address(swap).balance, 0);
        assertEq(usdc.balanceOf(address(swap)), 0);
    }

    function testFuzz_cancelReturnsExactly(uint96 mon, uint96 tokens) public {
        mon = uint96(bound(mon, 1, START_MON));
        tokens = uint96(bound(tokens, 1, START_TOKEN));
        uint256 id =
            _create(alice, _list(_native(mon), _erc20(address(usdc), tokens)), _list(_chog(B1)));
        vm.prank(alice);
        swap.cancelTrade(id);
        assertEq(alice.balance, START_MON);
        assertEq(usdc.balanceOf(alice), START_TOKEN);
        assertEq(address(swap).balance, 0);
        assertEq(usdc.balanceOf(address(swap)), 0);
    }

    function testFuzz_wrongNativeValueAlwaysReverts(uint96 requested, uint96 sent) public {
        requested = uint96(bound(requested, 1, START_MON));
        sent = uint96(bound(sent, 0, START_MON));
        vm.assume(sent != requested);
        uint256 id = _create(alice, _list(_chog(A1)), _list(_native(requested)));

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.WrongNativeAmount.selector, requested, sent)
        );
        swap.fillTrade{value: sent}(id);
    }

    function testFuzz_expiryBoundary(uint64 offset, uint64 warpBy) public {
        offset = uint64(bound(offset, 1, 365 days));
        warpBy = uint64(bound(warpBy, 0, 730 days));
        uint64 expiry = uint64(block.timestamp) + offset;
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)), address(0), expiry);

        vm.warp(block.timestamp + warpBy);
        bool expired = block.timestamp > expiry;
        assertEq(swap.isExpired(id), expired);

        if (expired) {
            vm.prank(bob);
            vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TradeIsExpired.selector, id));
            swap.fillTrade(id);
        } else {
            _fill(bob, id);
            assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Filled));
        }
    }

    function testFuzz_onlyMakerCancelsAndOnlyNamedTakerFills(address stranger) public {
        vm.assume(stranger != alice && stranger != bob && stranger != address(swap));
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)), bob, 0);

        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.NotMaker.selector, id));
        swap.cancelTrade(id);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.NotAllowedTaker.selector, id));
        swap.fillTrade(id);
        vm.stopPrank();
    }

    /// Any n ≤ MAX distinct NFTs per side round-trip through create and fill.
    function testFuzz_bundleSizes(uint8 offeredCount, uint8 requestedCount) public {
        uint256 offeredN = bound(offeredCount, 1, 10);
        uint256 requestedN = bound(requestedCount, 1, 10);
        chog.mint(alice, 10); // 16–25
        chog.mint(bob, 10); // 26–35

        uint256 id = _create(alice, _chogs(16, offeredN), _chogs(26, requestedN));
        _fill(bob, id);

        for (uint256 i; i < offeredN; ++i) {
            _assertOwner(16 + i, bob);
        }
        for (uint256 i; i < requestedN; ++i) {
            _assertOwner(26 + i, alice);
        }
    }
}
