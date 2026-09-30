// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IChogSwapV2} from "../../src/interfaces/IChogSwapV2.sol";
import {ChogSwapV2Base} from "./ChogSwapV2Base.sol";
import {MonReceiver} from "../utils/Actors.sol";
import {BlocklistToken, BlocklistNft} from "../utils/WeirdTokens.sol";

/// @dev A payout that the recipient or the token rejects must never block a fill, cancel or
///      reclaim. It becomes a credit that the recipient can `claim` later.
contract ChogSwapV2ClaimTest is ChogSwapV2Base {
    IChogSwapV2.AssetType internal constant NATIVE = IChogSwapV2.AssetType.Native;
    IChogSwapV2.AssetType internal constant ERC20 = IChogSwapV2.AssetType.ERC20;
    IChogSwapV2.AssetType internal constant ERC721 = IChogSwapV2.AssetType.ERC721;

    MonReceiver internal picky;
    BlocklistToken internal blk;
    BlocklistNft internal bnft;

    function setUp() public override {
        super.setUp();
        picky = new MonReceiver(); // rejects MON until told otherwise
        blk = new BlocklistToken();
        bnft = new BlocklistNft();
        vm.deal(address(picky), START_MON);
        chog.mint(address(picky), 3); // 16–18
        vm.prank(address(picky));
        chog.setApprovalForAll(address(swap), true);

        blk.mint(alice, START_TOKEN);
        vm.prank(alice);
        blk.approve(address(swap), type(uint256).max);
        bnft.mint(alice, 1);
        vm.prank(alice);
        bnft.setApprovalForAll(address(swap), true);
    }

    // ───────────────────────────────────────────── native

    function test_makerThatRejectsMonIsCreditedOnFill() public {
        uint256 id = _create(address(picky), _list(_chog(16)), _list(_native(2 ether)));
        _fill(bob, id);

        _assertOwner(16, bob);
        assertEq(uint8(_status(id)), uint8(IChogSwapV2.Status.Filled));
        assertEq(swap.claimable(address(picky), NATIVE, address(0), 0), 2 ether);
        assertEq(address(swap).balance, 2 ether);

        picky.setAccept(true);
        uint256 before = address(picky).balance;
        vm.expectEmit(true, true, false, true, address(swap));
        emit IChogSwapV2.Claimed(address(picky), address(0), NATIVE, 0, 2 ether);
        vm.prank(address(picky));
        swap.claim(NATIVE, address(0), 0);

        assertEq(address(picky).balance, before + 2 ether);
        assertEq(swap.claimable(address(picky), NATIVE, address(0), 0), 0);
        assertEq(address(swap).balance, 0);
    }

    function test_takerThatRejectsMonIsCreditedTheOfferedNative() public {
        uint256 id = _create(alice, _list(_native(3 ether)), _list(_chog(16)));
        vm.expectEmit(true, true, false, true, address(swap));
        emit IChogSwapV2.AssetCredited(address(picky), address(0), NATIVE, 0, 3 ether);
        vm.prank(address(picky));
        swap.fillTrade(id);

        _assertOwner(16, alice);
        assertEq(swap.claimable(address(picky), NATIVE, address(0), 0), 3 ether);
    }

    function test_creditsAddUpAcrossTrades() public {
        _fill(bob, _create(address(picky), _list(_chog(16)), _list(_native(1 ether))));
        _fill(bob, _create(address(picky), _list(_chog(17)), _list(_native(2 ether))));
        assertEq(swap.claimable(address(picky), NATIVE, address(0), 0), 3 ether);
    }

    function test_claimStaysWhileRecipientStillRejects() public {
        _fill(bob, _create(address(picky), _list(_chog(16)), _list(_native(1 ether))));

        vm.prank(address(picky));
        vm.expectRevert(IChogSwapV2.ClaimFailed.selector);
        swap.claim(NATIVE, address(0), 0);
        assertEq(swap.claimable(address(picky), NATIVE, address(0), 0), 1 ether);
    }

    function test_makerThatRejectsMonIsCreditedOnCancel() public {
        vm.prank(address(picky));
        uint256 id = swap.createTrade{value: 1 ether}(
            _list(_native(1 ether), _chog(16)), _list(_chog(B1)), address(0), 0
        );
        vm.prank(address(picky));
        swap.cancelTrade(id);

        _assertOwner(16, address(picky)); // the NFT still came back
        assertEq(swap.claimable(address(picky), NATIVE, address(0), 0), 1 ether);
    }

    // ───────────────────────────────────────────── ERC-20 / ERC-721 blocklists

    function test_blockedTakerDoesNotBlockTheFill() public {
        uint256 id = _create(alice, _list(_erc20(address(blk), 100 ether)), _list(_chog(B1)));
        blk.setBlocked(bob, true);
        _fill(bob, id);

        _assertOwner(B1, alice); // the deal happened
        assertEq(blk.balanceOf(bob), 0);
        assertEq(swap.claimable(bob, ERC20, address(blk), 0), 100 ether);
        assertEq(blk.balanceOf(address(swap)), 100 ether); // still escrowed for bob

        // Still blocked: claim fails and keeps the credit.
        vm.prank(bob);
        vm.expectRevert(IChogSwapV2.ClaimFailed.selector);
        swap.claim(ERC20, address(blk), 0);
        assertEq(swap.claimable(bob, ERC20, address(blk), 0), 100 ether);

        blk.setBlocked(bob, false);
        vm.prank(bob);
        swap.claim(ERC20, address(blk), 0);
        assertEq(blk.balanceOf(bob), 100 ether);
        assertEq(blk.balanceOf(address(swap)), 0);
    }

    function test_blockedMakerStillCancels() public {
        uint256 id =
            _create(alice, _list(_erc20(address(blk), 100 ether), _chog(A1)), _list(_chog(B1)));
        blk.setBlocked(alice, true);
        vm.prank(alice);
        swap.cancelTrade(id);

        _assertOwner(A1, alice); // the rest of the escrow isn't held hostage
        assertEq(uint8(_status(id)), uint8(IChogSwapV2.Status.Cancelled));
        assertEq(swap.claimable(alice, ERC20, address(blk), 0), 100 ether);
    }

    function test_blockedMakerStillReclaims() public {
        uint256 id = _create(
            alice,
            _list(_erc20(address(blk), 100 ether)),
            _list(_chog(B1)),
            address(0),
            uint64(block.timestamp + 1)
        );
        blk.setBlocked(alice, true);
        vm.warp(block.timestamp + 2);
        vm.prank(carol);
        swap.reclaimExpired(id);
        assertEq(swap.claimable(alice, ERC20, address(blk), 0), 100 ether);
    }

    function test_blockedNftRecipientIsCredited() public {
        uint256 id =
            _create(alice, _list(_nft(address(bnft), 1)), _list(_erc20(address(usdc), 5 ether)));
        bnft.setBlocked(bob, true);
        _fill(bob, id);

        assertEq(usdc.balanceOf(alice), START_TOKEN + 5 ether);
        assertEq(bnft.ownerOf(1), address(swap));
        assertEq(swap.claimable(bob, ERC721, address(bnft), 1), 1);

        vm.prank(bob);
        vm.expectRevert(IChogSwapV2.ClaimFailed.selector);
        swap.claim(ERC721, address(bnft), 1);

        bnft.setBlocked(bob, false);
        vm.prank(bob);
        swap.claim(ERC721, address(bnft), 1);
        assertEq(bnft.ownerOf(1), bob);
        assertEq(swap.claimable(bob, ERC721, address(bnft), 1), 0);
    }

    // ───────────────────────────────────────────── claim edge cases

    function test_claimRevertsWithNothing() public {
        vm.prank(alice);
        vm.expectRevert(IChogSwapV2.NothingToClaim.selector);
        swap.claim(NATIVE, address(0), 0);
    }

    function test_creditsAreKeyedByAssetAndAccount() public {
        _fill(bob, _create(address(picky), _list(_chog(16)), _list(_native(1 ether))));

        // Other account, other token, other type: nothing there.
        vm.prank(bob);
        vm.expectRevert(IChogSwapV2.NothingToClaim.selector);
        swap.claim(NATIVE, address(0), 0);
        vm.prank(address(picky));
        vm.expectRevert(IChogSwapV2.NothingToClaim.selector);
        swap.claim(ERC20, address(usdc), 0);
        vm.prank(address(picky));
        vm.expectRevert(IChogSwapV2.NothingToClaim.selector);
        swap.claim(ERC721, address(chog), 16);
    }

    function test_claimIsOneShot() public {
        _fill(bob, _create(address(picky), _list(_chog(16)), _list(_native(1 ether))));
        picky.setAccept(true);
        vm.startPrank(address(picky));
        swap.claim(NATIVE, address(0), 0);
        vm.expectRevert(IChogSwapV2.NothingToClaim.selector);
        swap.claim(NATIVE, address(0), 0);
        vm.stopPrank();
    }
}
