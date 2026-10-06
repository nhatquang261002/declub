// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDeClubEscrow} from "../../src/interfaces/IDeClubEscrow.sol";
import {DeClubEscrowBase} from "./DeClubEscrowBase.sol";
import {ReentrantReceiver} from "../utils/Actors.sol";
import {
    FeeToken,
    LyingToken,
    LyingNft,
    SoftNft,
    NoReturnToken,
    HookToken
} from "../utils/WeirdTokens.sol";

/// @dev Non-standard tokens and re-entry through token / MON callbacks.
contract DeClubEscrowTokensTest is DeClubEscrowBase {
    // ───────────────────────────────────────────── deposits are verified

    function test_feeOnTransferTokenIsRejectedAsOffered() public {
        FeeToken fee = new FeeToken();
        fee.mint(alice, 1_000 ether);
        vm.prank(alice);
        fee.approve(address(swap), type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.UnsupportedToken.selector, address(fee))
        );
        swap.createTrade(_list(_erc20(address(fee), 100 ether)), _list(_chog(B1)), address(0), 0);
        assertEq(fee.balanceOf(alice), 1_000 ether); // reverted, nothing moved
    }

    function test_tokenThatLiesAboutTransferIsRejected() public {
        LyingToken liar = new LyingToken();
        liar.mint(alice, 1_000 ether);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.UnsupportedToken.selector, address(liar))
        );
        swap.createTrade(_list(_erc20(address(liar), 100 ether)), _list(_chog(B1)), address(0), 0);
    }

    function test_nftThatLiesAboutTransferIsRejected() public {
        LyingNft liar = new LyingNft();
        liar.mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.NftNotReceived.selector, address(liar), 1)
        );
        swap.createTrade(_list(_nft(address(liar), 1)), _list(_chog(B1)), address(0), 0);
    }

    /// A maker can still *ask* for a fee token. The taker pays the full amount and the maker
    /// receives 1% less; the maker chose that token, so it's documented rather than blocked.
    function test_feeTokenAsRequestedMakerReceivesLess() public {
        FeeToken fee = new FeeToken();
        fee.mint(bob, 1_000 ether);
        vm.prank(bob);
        fee.approve(address(swap), type(uint256).max);

        uint256 id = _create(alice, _list(_chog(A1)), _list(_erc20(address(fee), 100 ether)));
        _fill(bob, id);

        _assertOwner(A1, bob);
        assertEq(fee.balanceOf(alice), 99 ether);
        assertEq(fee.balanceOf(address(swap)), 0);
    }

    // ───────────────────────────────────────────── no-return-value tokens

    function test_noReturnTokenWorksOnBothSides() public {
        NoReturnToken tether = new NoReturnToken();
        tether.mint(alice, 500e6);
        tether.mint(bob, 500e6);
        vm.prank(alice);
        tether.approve(address(swap), type(uint256).max);
        vm.prank(bob);
        tether.approve(address(swap), type(uint256).max);

        uint256 id = _create(alice, _list(_erc20(address(tether), 200e6)), _list(_chog(B1)));
        assertEq(tether.balanceOf(address(swap)), 200e6);
        _fill(bob, id);
        assertEq(tether.balanceOf(bob), 700e6);

        // ...and as the requested side.
        uint256 id2 = _create(alice, _list(_chog(A1)), _list(_erc20(address(tether), 100e6)));
        _fill(bob, id2);
        assertEq(tether.balanceOf(alice), 400e6);
    }

    function test_noReturnTokenRefunds() public {
        NoReturnToken tether = new NoReturnToken();
        tether.mint(alice, 500e6);
        vm.prank(alice);
        tether.approve(address(swap), type(uint256).max);
        uint256 id = _create(alice, _list(_erc20(address(tether), 200e6)), _list(_chog(B1)));
        vm.prank(alice);
        swap.cancelTrade(id);
        assertEq(tether.balanceOf(alice), 500e6);
    }

    // ───────────────────────────────────────────── re-entry

    function _assertBlocked(HookToken hook) internal view {
        assertTrue(hook.attempted(), "re-entry was not attempted");
        assertFalse(hook.reentrySucceeded(), "re-entry succeeded");
        assertEq(
            bytes4(hook.reentryRevertData()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
    }

    function _hookToken(address who) internal returns (HookToken hook) {
        hook = new HookToken();
        hook.mint(who, 1_000 ether);
        vm.prank(who);
        hook.approve(address(swap), type(uint256).max);
    }

    function test_tokenHookCannotReenterDuringDeposit() public {
        HookToken hook = _hookToken(alice);
        uint256 open = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        hook.arm(address(swap), abi.encodeCall(IDeClubEscrow.cancelTrade, (open)));

        _create(alice, _list(_erc20(address(hook), 10 ether)), _list(_chog(B2)));

        _assertBlocked(hook);
        assertEq(uint8(_status(open)), uint8(IDeClubEscrow.Status.Open));
    }

    function test_tokenHookCannotReenterDuringFill() public {
        HookToken hook = _hookToken(alice);
        uint256 id = _create(alice, _list(_erc20(address(hook), 10 ether)), _list(_chog(B1)));
        // The hook pays bob during the fill and tries to refill.
        hook.arm(address(swap), abi.encodeCall(IDeClubEscrow.fillTrade, (id)));

        _fill(bob, id);

        _assertBlocked(hook);
        assertEq(hook.balanceOf(bob), 10 ether);
        assertEq(hook.balanceOf(address(swap)), 0);
    }

    function test_tokenHookCannotReenterDuringCancel() public {
        HookToken hook = _hookToken(alice);
        uint256 id = _create(alice, _list(_erc20(address(hook), 10 ether)), _list(_chog(B1)));
        hook.arm(address(swap), abi.encodeCall(IDeClubEscrow.cancelTrade, (id)));

        vm.prank(alice);
        swap.cancelTrade(id);

        _assertBlocked(hook);
        assertEq(hook.balanceOf(alice), 1_000 ether);
    }

    function test_nativeReceiverCannotReenter() public {
        ReentrantReceiver attacker = new ReentrantReceiver();
        vm.deal(address(attacker), 0);
        chog.mint(address(attacker), 1); // 16
        vm.prank(address(attacker));
        chog.setApprovalForAll(address(swap), true);

        uint256 id = _create(address(attacker), _list(_chog(16)), _list(_native(1 ether)));
        attacker.arm(address(swap), abi.encodeCall(IDeClubEscrow.cancelTrade, (id)));

        _fill(bob, id);

        assertTrue(attacker.attempted());
        assertFalse(attacker.reentrySucceeded());
        assertEq(
            bytes4(attacker.reentryRevertData()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
        _assertOwner(16, bob);
        assertEq(address(attacker).balance, 1 ether);
    }

    function test_nativeReceiverCannotReenterClaim() public {
        ReentrantReceiver attacker = new ReentrantReceiver();
        // A native payout that re-enters claim().
        chog.mint(address(attacker), 1);
        vm.prank(address(attacker));
        chog.setApprovalForAll(address(swap), true);
        uint256 id = _create(address(attacker), _list(_chog(16)), _list(_native(1 ether)));
        attacker.arm(
            address(swap),
            abi.encodeCall(IDeClubEscrow.claim, (IDeClubEscrow.AssetType.Native, address(0), 0))
        );
        _fill(bob, id);

        assertTrue(attacker.attempted());
        assertFalse(attacker.reentrySucceeded());
        assertEq(
            bytes4(attacker.reentryRevertData()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
    }

    // ───────────────────────────────────────────── stray deposits

    function test_rejectsDirectMon() public {
        vm.prank(alice);
        (bool ok,) = address(swap).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(swap).balance, 0);
    }

    function test_rejectsSafeTransferOfNft() public {
        vm.prank(alice);
        vm.expectRevert(); // ERC721InvalidReceiver: no onERC721Received
        chog.safeTransferFrom(alice, address(swap), A1);
        _assertOwner(A1, alice);
    }

    // ───────────────────────────────────────────── the taker's NFTs are verified too

    function _softNft() internal returns (SoftNft soft) {
        soft = new SoftNft();
        soft.mint(alice, 1);
        soft.mint(carol, 2);
        vm.prank(alice);
        soft.setApprovalForAll(address(swap), true);
        vm.prank(bob);
        soft.setApprovalForAll(address(swap), true);
    }

    /// A collection that ignores an unauthorised transfer can't hand a taker the escrow for an
    /// NFT they don't own.
    function test_fillWithAnNftTheTakerDoesNotOwnReverts() public {
        SoftNft soft = _softNft();
        uint256 id = _create(alice, _list(_native(10 ether)), _list(_nft(address(soft), 2)));

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.NftNotReceived.selector, address(soft), 2)
        );
        swap.fillTrade(id);
        assertEq(soft.ownerOf(2), carol);
        assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Open));
    }

    function test_fillWithAnNftThatNeverMovesReverts() public {
        LyingNft liar = new LyingNft();
        liar.mint(bob, 2);
        uint256 id = _create(alice, _list(_chog(A1)), _list(_nft(address(liar), 2)));

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.NftNotReceived.selector, address(liar), 2)
        );
        swap.fillTrade(id);
        _assertOwner(A1, address(swap));
    }

    /// An id already held in escrow for one trade can't be listed again in another, so the
    /// second maker can't cancel their way to the first maker's NFT.
    function test_anEscrowedNftCannotBeListedTwice() public {
        SoftNft soft = _softNft();
        uint256 first = _create(alice, _list(_nft(address(soft), 1)), _list(_chog(B1)));
        assertEq(soft.ownerOf(1), address(swap));

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.NftNotReceived.selector, address(soft), 1)
        );
        swap.createTrade(_list(_nft(address(soft), 1)), _list(_chog(A2)), address(0), 0);

        vm.prank(alice);
        swap.cancelTrade(first);
        assertEq(soft.ownerOf(1), alice);
    }

    // ───────────────────────────────────────────── asset types match the contract

    /// ERC-20 and ERC-721 `transferFrom` share a selector: "6 units of an ERC-20" at the Chog
    /// collection would pull Chog #6 from a taker who approved the collection.
    function test_anNftCollectionCannotBeAskedForAsAnErc20() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidAsset.selector, 0));
        swap.createTrade(_list(_chog(A1)), _list(_erc20(address(chog), B1)), address(0), 0);
    }

    function test_anNftCollectionCannotBeOfferedAsAnErc20() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidAsset.selector, 0));
        swap.createTrade(_list(_erc20(address(chog), A1)), _list(_chog(B1)), address(0), 0);
    }

    function test_anErc20CannotBeAskedForAsAnNft() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidAsset.selector, 0));
        swap.createTrade(_list(_chog(A1)), _list(_nft(address(usdc), 100 ether)), address(0), 0);
    }

    function test_anErc20CannotBeATraitSet() public {
        IDeClubEscrow.Asset memory set = IDeClubEscrow.Asset(
            IDeClubEscrow.AssetType.ERC721Trait, address(usdc), uint256(keccak256("root")), 1
        );
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidAsset.selector, 0));
        swap.createTraitTrade(_list(_chog(A1)), _list(set), address(0), 0, "{}");
    }
}
