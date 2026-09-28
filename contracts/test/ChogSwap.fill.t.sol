// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IChogSwap} from "../src/interfaces/IChogSwap.sol";
import {ChogSwapBase} from "./utils/ChogSwapBase.sol";

contract ChogSwapFillTest is ChogSwapBase {
    // ─────────────────────────────────────────────── spec use cases

    /// Spec 4.1: Chog ↔ Chog
    function test_fill_nftForNft() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0);
        _fill(bob, id);

        _assertOwner(A1, bob);
        _assertOwner(B1, alice);
        assertEq(uint8(_status(id)), uint8(IChogSwap.Status.Filled));
        assertEq(chog.balanceOf(address(swap)), 0);
    }

    /// Spec 4.2: Chog + MON ↔ Chog
    function test_fill_nftPlusMonForNft() public {
        uint256 id = _create(alice, _ids(A1), 2 ether, _ids(B1), 0);
        _fill(bob, id);

        _assertOwner(A1, bob);
        _assertOwner(B1, alice);
        assertEq(alice.balance, START_MON - 2 ether);
        assertEq(bob.balance, START_MON + 2 ether);
        assertEq(address(swap).balance, 0);
    }

    /// Spec 4.3: Chog ↔ Chog + MON
    function test_fill_nftForNftPlusMon() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 3 ether);
        _fill(bob, id);

        _assertOwner(A1, bob);
        _assertOwner(B1, alice);
        assertEq(alice.balance, START_MON + 3 ether);
        assertEq(bob.balance, START_MON - 3 ether);
        assertEq(address(swap).balance, 0);
    }

    function test_fill_multipleChogsEachSide() public {
        uint256 id = _create(alice, _ids(A1, A2), 0, _ids(B1, B2, B3), 0);
        _fill(bob, id);

        _assertOwner(A1, bob);
        _assertOwner(A2, bob);
        _assertOwner(B1, alice);
        _assertOwner(B2, alice);
        _assertOwner(B3, alice);
    }

    function test_fill_maxTokensPerSide_gasBound() public {
        chog.mint(alice, 10); // 16–25
        chog.mint(bob, 10); // 26–35
        uint256 id = _create(alice, _range(16, 10), 0, _range(26, 10), 1 ether);

        uint256 gasBefore = gasleft();
        _fill(bob, id);
        uint256 used = gasBefore - gasleft();

        assertEq(chog.balanceOf(address(swap)), 0);
        _assertOwner(16, bob);
        _assertOwner(35, alice);
        // 20 NFT transfers + 1 MON send; keep well under a block's worth on any chain.
        assertLt(used, 1_500_000, "worst-case fill gas");
    }

    function test_fill_monOnlyOffer() public {
        uint256 id = _create(alice, _none(), 5 ether, _ids(B1), 0);
        _fill(bob, id);
        _assertOwner(B1, alice);
        assertEq(bob.balance, START_MON + 5 ether);
    }

    function test_fill_monOnlyRequest() public {
        uint256 id = _create(alice, _ids(A1), 0, _none(), 5 ether);
        _fill(carol, id); // anyone with MON can buy
        _assertOwner(A1, carol);
        assertEq(alice.balance, START_MON + 5 ether);
    }

    function test_fill_emitsTradeFilled() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0);
        vm.expectEmit(address(swap));
        emit IChogSwap.TradeFilled(id, alice, bob);
        _fill(bob, id);
    }

    function test_fill_directRequestByNamedTaker() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0, bob, 0);
        _fill(bob, id);
        _assertOwner(A1, bob);
    }

    function test_fill_atExactExpiry() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0, address(0), expiry);
        vm.warp(expiry);
        _fill(bob, id);
        assertEq(uint8(_status(id)), uint8(IChogSwap.Status.Filled));
    }

    // ─────────────────────────────────────────────── reverts

    function test_fill_revertsUnknownTrade() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.TradeNotOpen.selector, 42));
        swap.fillTrade(42);
    }

    function test_fill_revertsWhenFilled() public {
        uint256 id = _create(alice, _ids(A1), 0, _none(), 1 ether);
        _fill(bob, id);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.TradeNotOpen.selector, id));
        swap.fillTrade{value: 1 ether}(id);
    }

    function test_fill_revertsWhenCancelled() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0);
        vm.prank(alice);
        swap.cancelTrade(id);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.TradeNotOpen.selector, id));
        swap.fillTrade(id);
    }

    function test_fill_revertsWhenExpired() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0, address(0), expiry);
        vm.warp(expiry + 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.TradeIsExpired.selector, id));
        swap.fillTrade(id);
    }

    function test_fill_revertsForWrongTaker() public {
        uint256 id = _create(alice, _ids(A1), 0, _none(), 1 ether, bob, 0);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.NotAllowedTaker.selector, id));
        swap.fillTrade{value: 1 ether}(id);
    }

    function test_fill_revertsSelfFill() public {
        uint256 id = _create(alice, _ids(A1), 0, _none(), 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.SelfFill.selector, id));
        swap.fillTrade{value: 1 ether}(id);
    }

    function test_fill_revertsSelfFillWhenMakerIsNamedTaker() public {
        uint256 id = _create(alice, _ids(A1), 0, _none(), 1 ether, alice, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.SelfFill.selector, id));
        swap.fillTrade{value: 1 ether}(id);
    }

    function test_fill_revertsInsufficientMon() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 2 ether);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.WrongMonAmount.selector, 2 ether, 1 ether));
        swap.fillTrade{value: 1 ether}(id);
    }

    function test_fill_revertsExcessMon() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 2 ether);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IChogSwap.WrongMonAmount.selector, 2 ether, 3 ether));
        swap.fillTrade{value: 3 ether}(id);
    }

    function test_fill_revertsIfTakerDoesNotOwnRequested() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0);
        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721IncorrectOwner.selector, carol, B1, bob)
        );
        swap.fillTrade(id);
    }

    function test_fill_revertsIfTakerOwnsOnlySomeRequested() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1, C1), 0);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721IncorrectOwner.selector, bob, C1, carol)
        );
        swap.fillTrade(id);
        // Atomic: B1 did not move.
        _assertOwner(B1, bob);
        _assertOwner(A1, address(swap));
    }

    function test_fill_revertsWithoutTakerApproval() public {
        uint256 id = _create(alice, _ids(A1), 0, _ids(B1), 0);
        vm.prank(bob);
        chog.setApprovalForAll(address(swap), false);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC721Errors.ERC721InsufficientApproval.selector, address(swap), B1
            )
        );
        swap.fillTrade(id);
    }

    function test_fill_overlappingIdIsUnfillableButCancellable() public {
        // Alice both offers and requests A1: escrow holds it, so no taker can own it.
        uint256 id = _create(alice, _ids(A1), 0, _ids(A1), 0);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC721Errors.ERC721IncorrectOwner.selector, bob, A1, address(swap)
            )
        );
        swap.fillTrade(id);

        vm.prank(alice);
        swap.cancelTrade(id);
        _assertOwner(A1, alice);
    }
}
