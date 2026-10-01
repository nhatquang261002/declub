// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IChogSwapIntents} from "../../src/interfaces/IChogSwapIntents.sol";
import {ChogSwapIntentsBase} from "./ChogSwapIntentsBase.sol";

contract ChogSwapIntentsNoncesTest is ChogSwapIntentsBase {
    function _swapWithNonces(uint256 nonceA, uint256 nonceB)
        internal
        view
        returns (IChogSwapIntents.Intent[] memory cycle, bytes[] memory sigs)
    {
        return _chogForUsdc(100 ether, 100 ether, nonceA, nonceB);
    }

    function test_settledIntentCannotBeReplayed() public {
        (IChogSwapIntents.Intent[] memory cycle, bytes[] memory sigs) = _swapWithNonces(0, 0);
        swap.settle(cycle, sigs);

        // alice gets her Chog back so the replay would otherwise be possible.
        vm.prank(bob);
        chog.transferFrom(bob, alice, A1);

        vm.expectRevert(abi.encodeWithSelector(IChogSwapIntents.NonceUsed.selector, alice, 0));
        swap.settle(cycle, sigs);
    }

    function test_sameNonceForAMakerCannotBeUsedByAnotherIntent() public {
        (IChogSwapIntents.Intent[] memory first, bytes[] memory firstSigs) = _swapWithNonces(5, 5);
        swap.settle(first, firstSigs);

        // A different intent from alice that reuses nonce 5.
        vm.prank(bob);
        chog.transferFrom(bob, alice, A1);
        IChogSwapIntents.Intent memory a =
            _intent(alice, _list(_chog(A2)), _list(_erc20(address(weth), 1 ether)), 5);
        IChogSwapIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(weth), 1 ether)), _list(_chog(A2)), 6);
        IChogSwapIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        vm.expectRevert(abi.encodeWithSelector(IChogSwapIntents.NonceUsed.selector, alice, 5));
        swap.settle(cycle, sigs);
    }

    function test_invalidatedNonceNeverSettles() public {
        (IChogSwapIntents.Intent[] memory cycle, bytes[] memory sigs) = _swapWithNonces(3, 0);

        vm.expectEmit(true, false, false, true, address(swap));
        emit IChogSwapIntents.NoncesInvalidated(alice, 0, 1 << 3);
        vm.prank(alice);
        swap.invalidateNonces(0, 1 << 3);

        assertTrue(swap.isNonceUsed(alice, 3));
        vm.expectRevert(abi.encodeWithSelector(IChogSwapIntents.NonceUsed.selector, alice, 3));
        swap.settle(cycle, sigs);
        _assertOwner(A1, alice);
    }

    function test_invalidatingOneNonceLeavesOthersAlone() public {
        vm.prank(alice);
        swap.invalidateNonces(0, 1 << 3);

        assertTrue(swap.isNonceUsed(alice, 3));
        assertFalse(swap.isNonceUsed(alice, 2));
        assertFalse(swap.isNonceUsed(alice, 4));
        assertFalse(swap.isNonceUsed(bob, 3)); // per maker

        (IChogSwapIntents.Intent[] memory cycle, bytes[] memory sigs) = _swapWithNonces(4, 3);
        swap.settle(cycle, sigs);
        _assertOwner(A1, bob);
    }

    function test_masksCombineAcrossCalls() public {
        vm.startPrank(alice);
        swap.invalidateNonces(0, 0x3);
        swap.invalidateNonces(0, 0xC);
        vm.stopPrank();

        for (uint256 n; n < 4; ++n) {
            assertTrue(swap.isNonceUsed(alice, n));
        }
        assertFalse(swap.isNonceUsed(alice, 4));
    }

    function test_wordBoundaries() public {
        (IChogSwapIntents.Intent[] memory cycle, bytes[] memory sigs) = _swapWithNonces(255, 256);
        swap.settle(cycle, sigs);

        assertTrue(swap.isNonceUsed(alice, 255));
        assertFalse(swap.isNonceUsed(alice, 256));
        assertFalse(swap.isNonceUsed(alice, 254));
        assertTrue(swap.isNonceUsed(bob, 256));
        assertFalse(swap.isNonceUsed(bob, 255));
        assertFalse(swap.isNonceUsed(bob, 0));
    }

    function test_largestNonceWorks() public {
        (IChogSwapIntents.Intent[] memory cycle, bytes[] memory sigs) =
            _swapWithNonces(type(uint256).max, 1 << 200);
        swap.settle(cycle, sigs);

        assertTrue(swap.isNonceUsed(alice, type(uint256).max));
        assertTrue(swap.isNonceUsed(bob, 1 << 200));
        assertFalse(swap.isNonceUsed(alice, type(uint256).max - 1));
    }

    function testFuzz_nonceBitmapIsPerMakerAndPerBit(uint256 nonce, uint256 other) public {
        vm.assume(nonce != other);
        vm.prank(alice);
        swap.invalidateNonces(nonce >> 8, 1 << (nonce & 0xff));

        assertTrue(swap.isNonceUsed(alice, nonce));
        assertFalse(swap.isNonceUsed(bob, nonce));
        assertFalse(swap.isNonceUsed(alice, other));
    }
}
