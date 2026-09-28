// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IChogSwap} from "../src/interfaces/IChogSwap.sol";
import {ChogSwapBase} from "./utils/ChogSwapBase.sol";

contract ChogSwapCreateTest is ChogSwapBase {
    function test_create_escrowsOfferedChogsAndMon() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint256 id = _create(alice, _ids(A1, A2), 2 ether, _ids(B1), 0, bob, expiry);

        assertEq(id, 1);
        assertEq(swap.tradeCount(), 1);
        _assertOwner(A1, address(swap));
        _assertOwner(A2, address(swap));
        assertEq(address(swap).balance, 2 ether);
        assertEq(alice.balance, START_MON - 2 ether);

        IChogSwap.Trade memory t = swap.getTrade(id);
        assertEq(t.maker, alice);
        assertEq(t.taker, bob);
        assertEq(t.expiry, expiry);
        assertEq(uint8(t.status), uint8(IChogSwap.Status.Open));
        assertEq(t.offeredMon, 2 ether);
        assertEq(t.requestedMon, 0);
        assertEq(t.offeredIds, _ids(A1, A2));
        assertEq(t.requestedIds, _ids(B1));
    }

    function test_create_emitsTradeCreated() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.expectEmit(address(swap));
        emit IChogSwap.TradeCreated(1, alice, address(0), _ids(A1), 0, _ids(B1), 3 ether, expiry);
        _create(alice, _ids(A1), 0, _ids(B1), 3 ether, address(0), expiry);
    }

    function test_create_idsAreSequential() public {
        assertEq(_create(alice, _ids(A1), 0, _ids(B1), 0), 1);
        assertEq(_create(bob, _ids(B2), 0, _ids(A2), 0), 2);
        assertEq(_create(carol, _ids(C1), 0, _ids(A3), 0), 3);
        assertEq(swap.tradeCount(), 3);
    }

    function test_create_monOnlyOffer() public {
        // "Buy order": 5 MON for Bob's Chog.
        uint256 id = _create(alice, _none(), 5 ether, _ids(B1), 0);
        assertEq(swap.getTrade(id).offeredIds.length, 0);
        assertEq(address(swap).balance, 5 ether);
    }

    function test_create_monOnlyRequest() public {
        // "Sell order": Alice's Chog for 5 MON.
        uint256 id = _create(alice, _ids(A1), 0, _none(), 5 ether);
        assertEq(swap.getTrade(id).requestedMon, 5 ether);
        _assertOwner(A1, address(swap));
    }

    function test_create_allowsMaxTokensPerSide() public {
        chog.mint(alice, 5); // alice now owns 1–5 and 16–20
        uint256[] memory offered = new uint256[](10);
        for (uint256 i; i < 5; ++i) {
            offered[i] = i + 1;
            offered[i + 5] = 16 + i;
        }
        _create(alice, offered, 0, _range(6, 10), 0);
        assertEq(chog.balanceOf(address(swap)), 10);
    }

    function test_create_noExpiryNeverExpires() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0);
        vm.warp(block.timestamp + 100 * 365 days);
        assertFalse(swap.isExpired(id));
    }

    // ─────────────────────────────────────────────── reverts

    function test_create_revertsEmptyOffer() public {
        vm.prank(alice);
        vm.expectRevert(IChogSwap.EmptySide.selector);
        swap.createTrade(_none(), _ids(B1), 0, address(0), 0);
    }

    function test_create_revertsEmptyRequest() public {
        vm.prank(alice);
        vm.expectRevert(IChogSwap.EmptySide.selector);
        swap.createTrade(_ids(A1), _none(), 0, address(0), 0);
    }

    function test_create_revertsMonOnBothSides() public {
        vm.prank(alice);
        vm.expectRevert(IChogSwap.MonOnBothSides.selector);
        swap.createTrade{value: 1 ether}(_ids(A1), _ids(B1), 1 ether, address(0), 0);
    }

    function test_create_revertsTooManyOffered() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.TooManyTokens.selector, 11, 10));
        swap.createTrade(_range(1, 11), _ids(B1), 0, address(0), 0);
    }

    function test_create_revertsTooManyRequested() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.TooManyTokens.selector, 11, 10));
        swap.createTrade(_ids(A1), _range(5, 11), 0, address(0), 0);
    }

    function test_create_revertsExpiryNow() public {
        uint64 nowTs = uint64(block.timestamp);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.ExpiryInPast.selector, nowTs));
        swap.createTrade(_ids(A1), _ids(B1), 0, address(0), nowTs);
    }

    function test_create_revertsIfMakerDoesNotOwnOffered() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721IncorrectOwner.selector, alice, B1, bob)
        );
        swap.createTrade(_ids(B1), _ids(B2), 0, address(0), 0);
    }

    function test_create_revertsWithoutApproval() public {
        vm.prank(alice);
        chog.setApprovalForAll(address(swap), false);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC721Errors.ERC721InsufficientApproval.selector, address(swap), A1
            )
        );
        swap.createTrade(_ids(A1), _ids(B1), 0, address(0), 0);
    }

    function test_create_revertsOnDuplicateOffered() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC721Errors.ERC721IncorrectOwner.selector, alice, A1, address(swap)
            )
        );
        swap.createTrade(_ids(A1, A1), _ids(B1), 0, address(0), 0);
    }

    function test_create_revertLeavesNoState() public {
        vm.prank(alice);
        vm.expectRevert();
        swap.createTrade{value: 1 ether}(_ids(A1, B1), _ids(B2), 0, address(0), 0);
        assertEq(swap.tradeCount(), 0);
        _assertOwner(A1, alice);
        assertEq(address(swap).balance, 0);
    }
}
