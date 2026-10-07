// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IDeClubEscrow} from "../../src/interfaces/IDeClubEscrow.sol";
import {DeClubEscrowBase} from "./DeClubEscrowBase.sol";

contract DeClubEscrowFillTest is DeClubEscrowBase {
    function test_nftForNft() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        vm.expectEmit(true, true, true, true, address(swap));
        emit IDeClubEscrow.TradeFilled(id, alice, bob);
        _fill(bob, id);

        _assertOwner(A1, bob);
        _assertOwner(B1, alice);
        assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Filled));
    }

    function test_nftForErc20() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_erc20(address(usdc), 300 ether)));
        _fill(bob, id);

        _assertOwner(A1, bob);
        assertEq(usdc.balanceOf(alice), START_TOKEN + 300 ether);
        assertEq(usdc.balanceOf(bob), START_TOKEN - 300 ether);
        assertEq(usdc.balanceOf(address(swap)), 0);
    }

    function test_erc20ForErc20() public {
        uint256 id = _create(
            alice, _list(_erc20(address(usdc), 100 ether)), _list(_erc20(address(weth), 2 ether))
        );
        _fill(bob, id);

        assertEq(usdc.balanceOf(bob), START_TOKEN + 100 ether);
        assertEq(weth.balanceOf(alice), START_TOKEN + 2 ether);
        assertEq(usdc.balanceOf(address(swap)), 0);
    }

    function test_nativeForErc20() public {
        uint256 id = _create(alice, _list(_native(4 ether)), _list(_erc20(address(usdc), 50 ether)));
        _fill(bob, id);

        assertEq(bob.balance, START_MON + 4 ether);
        assertEq(usdc.balanceOf(alice), START_TOKEN + 50 ether);
        assertEq(address(swap).balance, 0);
    }

    function test_nftForNative() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_native(7 ether)));
        _fill(bob, id);

        _assertOwner(A1, bob);
        assertEq(alice.balance, START_MON + 7 ether);
        assertEq(bob.balance, START_MON - 7 ether);
    }

    function test_mixedBundlesBothWays() public {
        uint256 id = _create(
            alice,
            _list(_chog(A1), _erc20(address(usdc), 100 ether), _native(1 ether)),
            _list(_chog(B1), _erc20(address(weth), 3 ether))
        );
        _fill(bob, id);

        _assertOwner(A1, bob);
        _assertOwner(B1, alice);
        assertEq(usdc.balanceOf(bob), START_TOKEN + 100 ether);
        assertEq(weth.balanceOf(alice), START_TOKEN + 3 ether);
        assertEq(alice.balance, START_MON - 1 ether);
        assertEq(bob.balance, START_MON + 1 ether);
        assertEq(address(swap).balance, 0);
        assertEq(usdc.balanceOf(address(swap)), 0);
    }

    function test_directRequestOnlyForNamedTaker() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)), bob, 0);

        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.NotAllowedTaker.selector, id));
        swap.fillTrade(id);

        _fill(bob, id);
        _assertOwner(A1, bob);
    }

    function test_revertsSelfFill() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.SelfFill.selector, id));
        swap.fillTrade(id);
    }

    function test_revertsWrongNativeValue() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_native(2 ether)));
        vm.startPrank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.WrongNativeAmount.selector, 2 ether, 1 ether)
        );
        swap.fillTrade{value: 1 ether}(id);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.WrongNativeAmount.selector, 2 ether, 3 ether)
        );
        swap.fillTrade{value: 3 ether}(id);
        vm.stopPrank();
    }

    function test_revertsMonSentWhenNoneRequested() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.WrongNativeAmount.selector, 0, 1));
        swap.fillTrade{value: 1}(id);
    }

    function test_revertsWhenTakerLacksRequestedNft() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        vm.prank(carol);
        vm.expectRevert(); // ERC721IncorrectOwner: carol doesn't own B1
        swap.fillTrade(id);
        assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Open));
        _assertOwner(A1, address(swap));
    }

    function test_revertsWhenTakerLacksErc20() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_erc20(address(usdc), START_TOKEN + 1)));
        vm.prank(bob);
        vm.expectRevert();
        swap.fillTrade(id);
    }

    /// One failing asset reverts the whole fill: nothing moves.
    function test_fillIsAtomic() public {
        uint256 id = _create(
            alice,
            _list(_chog(A1), _erc20(address(usdc), 10 ether)),
            _list(_erc20(address(weth), 1 ether), _chog(B1))
        );
        // bob hands his B1 away, so the second requested asset fails after the first succeeded.
        vm.prank(bob);
        chog.transferFrom(bob, carol, B1);

        vm.prank(bob);
        vm.expectRevert();
        swap.fillTrade(id);

        assertEq(weth.balanceOf(alice), START_TOKEN);
        assertEq(usdc.balanceOf(bob), START_TOKEN);
        _assertOwner(A1, address(swap));
        assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Open));
    }

    function test_revertsWhenFilledTwice() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_erc20(address(usdc), 1 ether)));
        _fill(bob, id);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TradeNotOpen.selector, id));
        swap.fillTrade(id);
    }

    function test_revertsUnknownTrade() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TradeNotOpen.selector, 99));
        swap.fillTrade(99);
    }

    function test_expiryBoundary() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)), address(0), expiry);

        vm.warp(expiry); // still fillable at exactly `expiry`
        assertFalse(swap.isExpired(id));

        vm.warp(expiry + 1);
        assertTrue(swap.isExpired(id));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TradeIsExpired.selector, id));
        swap.fillTrade(id);
    }

    function test_requestedNftThatIsAlsoEscrowedCannotBeFilled() public {
        // Alice offers A1 and asks for A2, then moves A2 into another trade's escrow.
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(A2)));
        _create(alice, _list(_chog(A2)), _list(_chog(B2)));

        vm.prank(bob);
        vm.expectRevert(); // bob doesn't own A2
        swap.fillTrade(id);
    }

    function test_worstCaseGas() public {
        chog.mint(alice, 10); // 16–25
        chog.mint(bob, 10); // 26–35
        IDeClubEscrow.Asset[] memory offered = _chogs(16, 5);
        IDeClubEscrow.Asset[] memory requested = _chogs(26, 5);

        vm.prank(alice);
        uint256 createGas = gasleft();
        uint256 id = swap.createTrade(offered, requested, address(0), 0);
        createGas -= gasleft();

        vm.prank(bob);
        uint256 fillGas = gasleft();
        swap.fillTrade(id);
        fillGas -= gasleft();

        emit log_named_uint("create gas, 5 NFTs vs 5 NFTs", createGas);
        emit log_named_uint("fill gas, 5 NFTs vs 5 NFTs", fillGas);
        assertLt(createGas, 5_000_000);
        assertLt(fillGas, 3_000_000);
    }
}
