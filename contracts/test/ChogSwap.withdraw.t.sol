// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IChogSwap} from "../src/interfaces/IChogSwap.sol";
import {ChogSwapBase} from "./utils/ChogSwapBase.sol";
import {MonReceiver} from "./utils/Actors.sol";

/// @dev A maker or taker that rejects MON must never block settlement or refunds.
contract ChogSwapWithdrawTest is ChogSwapBase {
    MonReceiver internal wallet;
    uint256 internal constant W1 = 16; // first Chog minted to `wallet`

    function setUp() public override {
        super.setUp();
        wallet = new MonReceiver(); // starts rejecting MON
        _onboard(address(wallet));
    }

    function test_cancel_creditsMakerThatRejectsMon() public {
        uint256 id = _create(address(wallet), _ids(W1), 2 ether, _ids(B1), 0);

        vm.expectEmit(address(swap));
        emit IChogSwap.WithdrawalCredited(address(wallet), 2 ether);
        vm.prank(address(wallet));
        swap.cancelTrade(id);

        _assertOwner(W1, address(wallet)); // NFT refund unaffected
        assertEq(swap.pendingWithdrawal(address(wallet)), 2 ether);
        assertEq(address(swap).balance, 2 ether);
    }

    function test_fill_creditsMakerThatRejectsMon() public {
        uint256 id = _create(address(wallet), _ids(W1), 0, _ids(B1), 3 ether);
        _fill(bob, id);

        assertEq(uint8(_status(id)), uint8(IChogSwap.Status.Filled));
        _assertOwner(B1, address(wallet));
        assertEq(swap.pendingWithdrawal(address(wallet)), 3 ether);
    }

    function test_fill_creditsTakerThatRejectsMon() public {
        uint256 id = _create(alice, _ids(A1), 4 ether, _ids(W1), 0);
        _fill(address(wallet), id);

        _assertOwner(A1, address(wallet));
        assertEq(swap.pendingWithdrawal(address(wallet)), 4 ether);
    }

    function test_reclaim_creditsMakerThatRejectsMon() public {
        uint64 expiry = uint64(block.timestamp + 1);
        uint256 id = _create(address(wallet), _ids(W1), 1 ether, _ids(B1), 0, address(0), expiry);
        vm.warp(expiry + 1);
        swap.reclaimExpired(id);
        assertEq(swap.pendingWithdrawal(address(wallet)), 1 ether);
    }

    function test_withdraw_paysOutCredit() public {
        uint256 id = _create(address(wallet), _ids(W1), 2 ether, _ids(B1), 0);
        vm.prank(address(wallet));
        swap.cancelTrade(id);

        wallet.setAccept(true);
        uint256 before = address(wallet).balance;

        vm.expectEmit(address(swap));
        emit IChogSwap.Withdrawn(address(wallet), 2 ether);
        vm.prank(address(wallet));
        swap.withdraw();

        assertEq(address(wallet).balance, before + 2 ether);
        assertEq(swap.pendingWithdrawal(address(wallet)), 0);
        assertEq(address(swap).balance, 0);
    }

    function test_withdraw_revertsIfRecipientStillRejects() public {
        uint256 id = _create(address(wallet), _ids(W1), 2 ether, _ids(B1), 0);
        vm.prank(address(wallet));
        swap.cancelTrade(id);

        vm.prank(address(wallet));
        vm.expectRevert(IChogSwap.WithdrawFailed.selector);
        swap.withdraw();
        assertEq(swap.pendingWithdrawal(address(wallet)), 2 ether, "credit must survive");
    }

    function test_withdraw_revertsWhenNothingOwed() public {
        vm.prank(alice);
        vm.expectRevert(IChogSwap.NothingToWithdraw.selector);
        swap.withdraw();
    }
}
