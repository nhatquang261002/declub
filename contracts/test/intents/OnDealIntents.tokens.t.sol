// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IOnDealIntents} from "../../src/interfaces/IOnDealIntents.sol";
import {
    FeeToken,
    LyingToken,
    LyingNft,
    NoReturnToken,
    BlocklistToken,
    BlocklistNft,
    HookToken
} from "../utils/WeirdTokens.sol";
import {OnDealIntentsBase} from "./OnDealIntentsBase.sol";

/// @dev Odd tokens in an intent can only hurt the intents that name them, and never leave
///      anything half-moved or stuck: the contract holds nothing, so a bad leg reverts the lot.
contract OnDealIntentsTokensTest is OnDealIntentsBase {
    function _expectSettle(
        bytes memory err,
        IOnDealIntents.Intent memory a,
        IOnDealIntents.Intent memory b
    ) internal {
        IOnDealIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));
        if (err.length == 0) {
            swap.settle(cycle, sigs);
        } else {
            vm.expectRevert(err);
            swap.settle(cycle, sigs);
        }
    }

    /// @dev Alice gives Chog A1; bob gives `amount` of `token` (both want the other's side).
    function _chogFor(address token, uint256 amount)
        internal
        view
        returns (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b)
    {
        a = _intent(alice, _list(_chog(A1)), _list(_erc20(token, amount)), 0);
        b = _intent(bob, _list(_erc20(token, amount)), _list(_chog(A1)), 0);
    }

    // ───────────────────────────────────────────── ERC-20 oddities

    function test_feeOnTransferTokenIsRefused() public {
        FeeToken fee = new FeeToken();
        fee.mint(bob, 1_000 ether);
        vm.prank(bob);
        fee.approve(address(swap), type(uint256).max);

        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) =
            _chogFor(address(fee), 100 ether);
        _expectSettle(
            abi.encodeWithSelector(IOnDealIntents.UnsupportedToken.selector, address(fee)), a, b
        );

        _assertOwner(A1, alice);
        assertEq(fee.balanceOf(bob), 1_000 ether);
    }

    function test_tokenThatLiesAboutTransferIsRefused() public {
        LyingToken liar = new LyingToken();
        liar.mint(bob, 1_000 ether);

        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) =
            _chogFor(address(liar), 100 ether);
        _expectSettle(
            abi.encodeWithSelector(IOnDealIntents.UnsupportedToken.selector, address(liar)), a, b
        );

        _assertOwner(A1, alice);
    }

    function test_nftThatLiesAboutTransferIsRefused() public {
        LyingNft liar = new LyingNft();
        liar.mint(alice, 1);
        vm.prank(alice);
        liar.setApprovalForAll(address(swap), true);

        IOnDealIntents.Intent memory a = _intent(
            alice, _list(_nft(address(liar), 1)), _list(_erc20(address(usdc), 10 ether)), 0
        );
        IOnDealIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(usdc), 10 ether)), _list(_nft(address(liar), 1)), 0);

        _expectSettle(
            abi.encodeWithSelector(IOnDealIntents.NftNotReceived.selector, address(liar), 1), a, b
        );
        assertEq(usdc.balanceOf(bob), START_TOKEN);
    }

    function test_noReturnTokenSettles() public {
        NoReturnToken usdt = new NoReturnToken();
        usdt.mint(bob, 1_000e6);
        vm.prank(bob);
        usdt.approve(address(swap), type(uint256).max);

        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) =
            _chogFor(address(usdt), 500e6);
        _expectSettle("", a, b);

        _assertOwner(A1, bob);
        assertEq(usdt.balanceOf(alice), 500e6);
        assertEq(usdt.balanceOf(address(swap)), 0);
    }

    // ───────────────────────────────────────────── blocklists revert the whole settlement

    function test_blockedErc20RecipientRevertsWithoutLockingAnything() public {
        BlocklistToken blk = new BlocklistToken();
        blk.mint(bob, 1_000 ether);
        vm.prank(bob);
        blk.approve(address(swap), type(uint256).max);
        blk.setBlocked(alice, true);

        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) =
            _chogFor(address(blk), 100 ether);
        IOnDealIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        vm.expectRevert();
        swap.settle(cycle, sigs);
        _assertOwner(A1, alice);
        assertEq(blk.balanceOf(bob), 1_000 ether);
        assertFalse(swap.isNonceUsed(alice, 0));

        blk.setBlocked(alice, false);
        swap.settle(cycle, sigs);
        _assertOwner(A1, bob);
        assertEq(blk.balanceOf(alice), 100 ether);
    }

    function test_blockedNftRecipientReverts() public {
        BlocklistNft nft = new BlocklistNft();
        nft.mint(alice, 1);
        vm.prank(alice);
        nft.setApprovalForAll(address(swap), true);
        nft.setBlocked(bob, true);

        IOnDealIntents.Intent memory a =
            _intent(alice, _list(_nft(address(nft), 1)), _list(_erc20(address(usdc), 10 ether)), 0);
        IOnDealIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(usdc), 10 ether)), _list(_nft(address(nft), 1)), 0);
        IOnDealIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        vm.expectRevert();
        swap.settle(cycle, sigs);
        assertEq(nft.ownerOf(1), alice);
        assertEq(usdc.balanceOf(bob), START_TOKEN);
    }

    // ───────────────────────────────────────────── re-entry

    function _assertBlocked(HookToken hook) internal view {
        assertTrue(hook.attempted(), "re-entry was not attempted");
        assertFalse(hook.reentrySucceeded(), "re-entry succeeded");
        assertEq(
            bytes4(hook.reentryRevertData()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
    }

    /// @dev The hook token pays bob mid-settlement and tries to settle again.
    function test_tokenHookCannotReenterSettle() public {
        HookToken hook = new HookToken();
        hook.mint(alice, 1_000 ether);
        vm.prank(alice);
        hook.approve(address(swap), type(uint256).max);

        IOnDealIntents.Intent memory a =
            _intent(alice, _list(_erc20(address(hook), 10 ether)), _list(_chog(B1)), 0);
        IOnDealIntents.Intent memory b =
            _intent(bob, _list(_chog(B1)), _list(_erc20(address(hook), 10 ether)), 0);
        IOnDealIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));
        hook.arm(address(swap), abi.encodeCall(swap.settle, (cycle, sigs)));

        swap.settle(cycle, sigs);

        _assertBlocked(hook);
        assertEq(hook.balanceOf(bob), 10 ether);
        _assertOwner(B1, alice);
        assertEq(hook.balanceOf(address(swap)), 0);
    }

    /// @dev Even a hook that re-enters with a *different*, fully valid cycle is refused.
    function test_tokenHookCannotReenterWithAnotherValidCycle() public {
        HookToken hook = new HookToken();
        hook.mint(alice, 1_000 ether);
        vm.prank(alice);
        hook.approve(address(swap), type(uint256).max);

        IOnDealIntents.Intent memory a =
            _intent(alice, _list(_erc20(address(hook), 10 ether)), _list(_chog(B1)), 0);
        IOnDealIntents.Intent memory b =
            _intent(bob, _list(_chog(B1)), _list(_erc20(address(hook), 10 ether)), 0);
        IOnDealIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        // A separate valid swap between carol and dave, with fresh nonces.
        IOnDealIntents.Intent memory c =
            _intent(carol, _list(_chog(C1)), _list(_erc20(address(usdc), 5 ether)), 0);
        IOnDealIntents.Intent memory d =
            _intent(dave, _list(_erc20(address(usdc), 5 ether)), _list(_chog(C1)), 0);
        IOnDealIntents.Intent[] memory other = _cycle2(c, d);
        bytes[] memory otherSigs = _sigs2(_sign(carolKey, c), _sign(daveKey, d));
        hook.arm(address(swap), abi.encodeCall(swap.settle, (other, otherSigs)));

        swap.settle(cycle, sigs);

        _assertBlocked(hook);
        _assertOwner(C1, carol); // the nested swap did not happen
        assertFalse(swap.isNonceUsed(carol, 0));
    }
}
