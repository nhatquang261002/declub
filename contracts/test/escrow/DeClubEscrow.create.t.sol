// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IDeClubEscrow} from "../../src/interfaces/IDeClubEscrow.sol";
import {DeClubEscrowBase} from "./DeClubEscrowBase.sol";

contract DeClubEscrowCreateTest is DeClubEscrowBase {
    function test_escrowsEveryAssetType() public {
        uint256 id = _create(
            alice,
            _list(_chog(A1), _erc20(address(usdc), 250 ether), _native(3 ether)),
            _list(_erc20(address(weth), 1 ether))
        );

        assertEq(id, 1);
        assertEq(swap.tradeCount(), 1);
        _assertOwner(A1, address(swap));
        assertEq(usdc.balanceOf(address(swap)), 250 ether);
        assertEq(usdc.balanceOf(alice), START_TOKEN - 250 ether);
        assertEq(address(swap).balance, 3 ether);
        assertEq(alice.balance, START_MON - 3 ether);
    }

    function test_storesTerms() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint256 id = _create(
            alice, _list(_chog(A1)), _list(_erc20(address(usdc), 5 ether), _chog(B1)), bob, expiry
        );

        IDeClubEscrow.Trade memory t = swap.getTrade(id);
        assertEq(t.maker, alice);
        assertEq(t.taker, bob);
        assertEq(t.expiry, expiry);
        assertEq(uint8(t.status), uint8(IDeClubEscrow.Status.Open));
        assertEq(t.offered.length, 1);
        assertEq(t.offered[0].token, address(chog));
        assertEq(t.offered[0].id, A1);
        assertEq(t.requested.length, 2);
        assertEq(uint8(t.requested[0].assetType), uint8(IDeClubEscrow.AssetType.ERC20));
        assertEq(t.requested[0].amount, 5 ether);
        assertEq(t.requested[1].id, B1);
    }

    function test_emitsTradeCreated() public {
        IDeClubEscrow.Asset[] memory offered = _list(_chog(A1));
        IDeClubEscrow.Asset[] memory requested = _list(_erc20(address(usdc), 5 ether));

        vm.expectEmit(true, true, true, true, address(swap));
        emit IDeClubEscrow.TradeCreated(1, alice, bob, offered, requested, 0);
        _create(alice, offered, requested, bob, 0);
    }

    function test_idsIncrement() public {
        assertEq(_create(alice, _list(_chog(A1)), _list(_chog(B1))), 1);
        assertEq(_create(alice, _list(_chog(A2)), _list(_chog(B2))), 2);
        assertEq(uint8(_status(0)), uint8(IDeClubEscrow.Status.None));
    }

    function test_maxNftsPerSide() public {
        uint256 max = swap.MAX_NFTS_PER_SIDE();
        assertEq(max, 5);
        chog.mint(alice, 10); // alice: 1–5 and 16–25
        IDeClubEscrow.Asset[] memory offered = _chogs(16, max);
        uint256 id = _create(alice, offered, _chogs(B1, 5));
        assertEq(swap.getTrade(id).offered.length, max);
    }

    function test_revertsTooManyNfts() public {
        uint256 max = swap.MAX_NFTS_PER_SIDE();
        chog.mint(alice, 10);
        chog.mint(bob, 10);
        IDeClubEscrow.Asset[] memory tooMany = _chogs(16, max + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TooManyNfts.selector, max + 1, max));
        swap.createTrade(tooMany, _list(_chog(B1)), address(0), 0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TooManyNfts.selector, max + 1, max));
        swap.createTrade(_list(_chog(A1)), _chogs(26, max + 1), address(0), 0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TooManyNfts.selector, max + 1, max));
        swap.createOpenOffer(tooMany, address(0), 0, "");
    }

    // ───────────────────────────────────────────── validation

    function test_revertsEmptySides() public {
        IDeClubEscrow.Asset[] memory none = new IDeClubEscrow.Asset[](0);
        vm.startPrank(alice);
        vm.expectRevert(IDeClubEscrow.EmptySide.selector);
        swap.createTrade(none, _list(_chog(B1)), address(0), 0);
        vm.expectRevert(IDeClubEscrow.EmptySide.selector);
        swap.createTrade(_list(_chog(A1)), none, address(0), 0);
        vm.stopPrank();
    }

    function test_revertsTooManyAssets() public {
        uint256 max = swap.MAX_ASSETS_PER_SIDE();
        chog.mint(alice, 10);
        chog.mint(alice, 10);
        IDeClubEscrow.Asset[] memory tooMany = _chogs(16, max + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TooManyAssets.selector, max + 1, max));
        swap.createTrade(tooMany, _list(_chog(B1)), address(0), 0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TooManyAssets.selector, max + 1, max));
        swap.createTrade(_list(_chog(A1)), tooMany, address(0), 0);
    }

    function test_revertsInvalidNative() public {
        // token set
        _expectInvalid(
            IDeClubEscrow.Asset(IDeClubEscrow.AssetType.Native, address(usdc), 0, 1 ether)
        );
        // id set
        _expectInvalid(IDeClubEscrow.Asset(IDeClubEscrow.AssetType.Native, address(0), 1, 1 ether));
        // zero amount
        _expectInvalid(_native(0));
    }

    function test_revertsInvalidErc20() public {
        _expectInvalid(_erc20(address(0), 1 ether)); // no code
        _expectInvalid(_erc20(alice, 1 ether)); // EOA
        _expectInvalid(_erc20(address(usdc), 0)); // zero amount
        _expectInvalid(
            IDeClubEscrow.Asset(IDeClubEscrow.AssetType.ERC20, address(usdc), 7, 1 ether)
        );
    }

    function test_revertsInvalidNft() public {
        _expectInvalid(_nft(address(0), 1)); // no code
        _expectInvalid(_nft(alice, 1)); // EOA
        _expectInvalid(IDeClubEscrow.Asset(IDeClubEscrow.AssetType.ERC721, address(chog), 1, 2));
        _expectInvalid(IDeClubEscrow.Asset(IDeClubEscrow.AssetType.ERC721, address(chog), 1, 0));
    }

    /// @dev Requested side is validated too, and reports its own index.
    function _expectInvalid(IDeClubEscrow.Asset memory bad) internal {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidAsset.selector, 1));
        swap.createTrade{value: 0}(_list(_chog(A1)), _list(_chog(B1), bad), address(0), 0);
    }

    function test_revertsDuplicateAssetOnOneSide() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.DuplicateAsset.selector, 1));
        swap.createTrade(_list(_chog(A1), _chog(A1)), _list(_chog(B1)), address(0), 0);

        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.DuplicateAsset.selector, 1));
        swap.createTrade(
            _list(_chog(A1)),
            _list(_erc20(address(usdc), 1), _erc20(address(usdc), 2)),
            address(0),
            0
        );
        vm.stopPrank();
    }

    function test_sameTokenDifferentIdIsNotADuplicate() public {
        _create(alice, _list(_chog(A1), _chog(A2)), _list(_chog(B1), _chog(B2)));
    }

    function test_revertsSameAssetOnBothSides() public {
        vm.startPrank(alice);
        // NFT
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.SameAssetBothSides.selector, 0, 1));
        swap.createTrade(_list(_chog(A1)), _list(_chog(B1), _chog(A1)), address(0), 0);
        // ERC-20, even with different amounts
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.SameAssetBothSides.selector, 1, 0));
        swap.createTrade(
            _list(_chog(A1), _erc20(address(usdc), 1 ether)),
            _list(_erc20(address(usdc), 2 ether)),
            address(0),
            0
        );
        // native for native
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.SameAssetBothSides.selector, 0, 0));
        swap.createTrade{value: 1 ether}(
            _list(_native(1 ether)), _list(_native(2 ether)), address(0), 0
        );
        vm.stopPrank();
    }

    function test_revertsWrongNativeValue() public {
        vm.startPrank(alice);
        // native offered, too little / too much
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.WrongNativeAmount.selector, 2 ether, 1 ether)
        );
        swap.createTrade{value: 1 ether}(_list(_native(2 ether)), _list(_chog(B1)), address(0), 0);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.WrongNativeAmount.selector, 2 ether, 3 ether)
        );
        swap.createTrade{value: 3 ether}(_list(_native(2 ether)), _list(_chog(B1)), address(0), 0);
        // value sent but nothing native offered
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.WrongNativeAmount.selector, 0, 1));
        swap.createTrade{value: 1}(_list(_chog(A1)), _list(_chog(B1)), address(0), 0);
        vm.stopPrank();
    }

    function test_requestedNativeIsNotEscrowed() public {
        // Asking for MON needs no msg.value at creation.
        _create(alice, _list(_chog(A1)), _list(_native(5 ether)));
        assertEq(address(swap).balance, 0);
    }

    function test_revertsExpiryInPast() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.ExpiryInPast.selector, uint64(block.timestamp))
        );
        swap.createTrade(_list(_chog(A1)), _list(_chog(B1)), address(0), uint64(block.timestamp));
    }

    function test_revertsWhenMakerDoesNotOwnNft() public {
        vm.prank(alice);
        vm.expectRevert(); // ERC721InsufficientApproval / IncorrectOwner
        swap.createTrade(_list(_chog(B1)), _list(_chog(A1)), address(0), 0);
    }

    function test_revertsWithoutErc20Allowance() public {
        vm.prank(alice);
        usdc.approve(address(swap), 0);
        vm.prank(alice);
        vm.expectRevert(); // ERC20InsufficientAllowance
        swap.createTrade(_list(_erc20(address(usdc), 1 ether)), _list(_chog(B1)), address(0), 0);
    }

    function test_revertsWhenErc20BalanceTooLow() public {
        vm.prank(alice);
        vm.expectRevert(); // ERC20InsufficientBalance
        swap.createTrade(
            _list(_erc20(address(usdc), START_TOKEN + 1)), _list(_chog(B1)), address(0), 0
        );
    }

    function test_revertsOnDuplicateNftAcrossCalls() public {
        _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        vm.prank(alice);
        vm.expectRevert(); // alice no longer owns A1
        swap.createTrade(_list(_chog(A1)), _list(_chog(B2)), address(0), 0);
    }
}
