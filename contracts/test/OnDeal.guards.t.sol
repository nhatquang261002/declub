// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {OnDeal} from "../src/OnDeal.sol";
import {IOnDeal} from "../src/interfaces/IOnDeal.sol";
import {OnDealBase} from "./utils/OnDealBase.sol";

/// @dev Deployment checks, views, and "assets can only enter through createTrade".
contract OnDealGuardsTest is OnDealBase {
    function test_constructor_setsCollection() public view {
        assertEq(swap.chog(), address(chog));
        assertEq(swap.MAX_TOKENS_PER_SIDE(), 10);
        assertEq(swap.tradeCount(), 0);
    }

    function test_constructor_revertsForZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(OnDeal.InvalidCollection.selector, address(0)));
        new OnDeal(address(0));
    }

    function test_constructor_revertsForEoa() public {
        vm.expectRevert(abi.encodeWithSelector(OnDeal.InvalidCollection.selector, alice));
        new OnDeal(alice);
    }

    function test_getTrade_unknownIdIsNone() public view {
        IOnDeal.Trade memory t = swap.getTrade(123);
        assertEq(uint8(t.status), uint8(IOnDeal.Status.None));
        assertEq(t.maker, address(0));
        assertFalse(swap.isExpired(123));
    }

    function test_rejectsDirectMon() public {
        vm.prank(alice);
        (bool ok,) = address(swap).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(swap).balance, 0);
    }

    function test_rejectsSafeTransfer() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(swap))
        );
        chog.safeTransferFrom(alice, address(swap), A1);
    }
}
