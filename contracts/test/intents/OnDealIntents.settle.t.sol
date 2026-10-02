// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IOnDealIntents} from "../../src/interfaces/IOnDealIntents.sol";
import {OnDealIntentsBase} from "./OnDealIntentsBase.sol";

contract OnDealIntentsSettleTest is OnDealIntentsBase {
    function _assertHoldsNothing() internal view {
        assertEq(address(swap).balance, 0);
        assertEq(usdc.balanceOf(address(swap)), 0);
        assertEq(weth.balanceOf(address(swap)), 0);
        assertEq(chog.balanceOf(address(swap)), 0);
    }

    // ───────────────────────────────────────────── two parties

    function test_swapsNftForErc20() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) =
            _chogForUsdc(100 ether, 100 ether, 0, 0);

        swap.settle(cycle, sigs);

        _assertOwner(A1, bob);
        assertEq(usdc.balanceOf(alice), START_TOKEN + 100 ether);
        assertEq(usdc.balanceOf(bob), START_TOKEN - 100 ether);
        _assertHoldsNothing();
    }

    function test_anyoneCanSettle() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) =
            _chogForUsdc(100 ether, 100 ether, 0, 0);

        vm.prank(makeAddr("stranger"));
        swap.settle(cycle, sigs);

        _assertOwner(A1, bob);
    }

    /// @dev Alice asks for at least 90 and bob gives 100: alice keeps the surplus.
    function test_surplusGoesToTheReceiver() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) =
            _chogForUsdc(90 ether, 100 ether, 0, 0);

        swap.settle(cycle, sigs);

        assertEq(usdc.balanceOf(alice), START_TOKEN + 100 ether);
        assertEq(usdc.balanceOf(bob), START_TOKEN - 100 ether);
    }

    /// @dev `give` is paid in full: assets the receiver didn't ask for go to them too.
    function test_unrequestedGiveAssetsGoToTheReceiver() public {
        IOnDealIntents.Intent memory a =
            _intent(alice, _list(_chog(A1), _chog(A2)), _list(_erc20(address(usdc), 50 ether)), 0);
        IOnDealIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(usdc), 50 ether)), _list(_chog(A1)), 0);

        swap.settle(_cycle2(a, b), _sigs2(_sign(aliceKey, a), _sign(bobKey, b)));

        _assertOwner(A1, bob);
        _assertOwner(A2, bob);
    }

    function test_multiAssetSwapAtTheMaximum() public {
        chog.mint(alice, 5);
        chog.mint(bob, 5); // alice: 1–5, 21–25; bob: 6–10, 26–30
        IOnDealIntents.Asset[] memory aliceGives = new IOnDealIntents.Asset[](10);
        IOnDealIntents.Asset[] memory bobGives = new IOnDealIntents.Asset[](10);
        for (uint256 i; i < 5; ++i) {
            aliceGives[i] = _chog(1 + i);
            aliceGives[5 + i] = _chog(21 + i);
            bobGives[i] = _chog(6 + i);
            bobGives[5 + i] = _chog(26 + i);
        }
        IOnDealIntents.Intent memory a = _intent(alice, aliceGives, bobGives, 0);
        IOnDealIntents.Intent memory b = _intent(bob, bobGives, aliceGives, 0);

        swap.settle(_cycle2(a, b), _sigs2(_sign(aliceKey, a), _sign(bobKey, b)));

        _assertOwner(1, bob);
        _assertOwner(25, bob);
        _assertOwner(6, alice);
        _assertOwner(30, alice);
        _assertHoldsNothing();
    }

    function test_mixedAssetsBothWays() public {
        IOnDealIntents.Intent memory a = _intent(
            alice,
            _list(_chog(A1), _erc20(address(weth), 5 ether)),
            _list(_chog(B1), _erc20(address(usdc), 20 ether)),
            0
        );
        IOnDealIntents.Intent memory b = _intent(
            bob,
            _list(_chog(B1), _erc20(address(usdc), 20 ether)),
            _list(_chog(A1), _erc20(address(weth), 5 ether)),
            0
        );

        swap.settle(_cycle2(a, b), _sigs2(_sign(aliceKey, a), _sign(bobKey, b)));

        _assertOwner(A1, bob);
        _assertOwner(B1, alice);
        assertEq(weth.balanceOf(bob), START_TOKEN + 5 ether);
        assertEq(usdc.balanceOf(alice), START_TOKEN + 20 ether);
    }

    function test_marksNoncesUsedAndEmitsEvents() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) =
            _chogForUsdc(100 ether, 100 ether, 7, 300);
        bytes32 hashA = swap.hashIntent(cycle[0]);
        bytes32 hashB = swap.hashIntent(cycle[1]);

        vm.expectEmit(true, true, true, true, address(swap));
        emit IOnDealIntents.IntentFilled(hashA, alice, bob, 7);
        vm.expectEmit(true, true, true, true, address(swap));
        emit IOnDealIntents.IntentFilled(hashB, bob, alice, 300);
        swap.settle(cycle, sigs);

        assertTrue(swap.isNonceUsed(alice, 7));
        assertTrue(swap.isNonceUsed(bob, 300));
        assertFalse(swap.isNonceUsed(alice, 8));
        assertFalse(swap.isNonceUsed(bob, 7));
    }

    // ───────────────────────────────────────────── rings

    /// @dev alice → bob → carol → alice. Alice gives Chog A1 to bob, bob gives WETH to carol,
    ///      carol gives USDC to alice.
    function test_threeWayRing() public {
        IOnDealIntents.Intent memory a =
            _intent(alice, _list(_chog(A1)), _list(_erc20(address(usdc), 50 ether)), 0);
        IOnDealIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(weth), 10 ether)), _list(_chog(A1)), 0);
        IOnDealIntents.Intent memory c = _intent(
            carol, _list(_erc20(address(usdc), 50 ether)), _list(_erc20(address(weth), 10 ether)), 0
        );

        swap.settle(
            _cycle3(a, b, c), _sigs3(_sign(aliceKey, a), _sign(bobKey, b), _sign(carolKey, c))
        );

        _assertOwner(A1, bob);
        assertEq(weth.balanceOf(carol), START_TOKEN + 10 ether);
        assertEq(usdc.balanceOf(alice), START_TOKEN + 50 ether);
        assertEq(weth.balanceOf(bob), START_TOKEN - 10 ether);
        assertEq(usdc.balanceOf(carol), START_TOKEN - 50 ether);
        _assertHoldsNothing();
    }

    function test_fourWayRingAtMaxCycle() public {
        // alice: Chog → bob; bob: Chog → carol; carol: Chog → dave; dave: Chog → alice
        IOnDealIntents.Intent[] memory cycle = new IOnDealIntents.Intent[](4);
        cycle[0] = _intent(alice, _list(_chog(A1)), _list(_chog(D1)), 0);
        cycle[1] = _intent(bob, _list(_chog(B1)), _list(_chog(A1)), 0);
        cycle[2] = _intent(carol, _list(_chog(C1)), _list(_chog(B1)), 0);
        cycle[3] = _intent(dave, _list(_chog(D1)), _list(_chog(C1)), 0);
        uint256[] memory keys = new uint256[](4);
        (keys[0], keys[1], keys[2], keys[3]) = (aliceKey, bobKey, carolKey, daveKey);

        swap.settle(cycle, _signAll(cycle, keys));

        _assertOwner(A1, bob);
        _assertOwner(B1, carol);
        _assertOwner(C1, dave);
        _assertOwner(D1, alice);
        _assertHoldsNothing();
    }

    /// @dev Any rotation of the same cycle settles identically.
    function test_rotatedCycleSettlesTheSame() public {
        IOnDealIntents.Intent memory a =
            _intent(alice, _list(_chog(A1)), _list(_erc20(address(usdc), 50 ether)), 0);
        IOnDealIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(weth), 10 ether)), _list(_chog(A1)), 0);
        IOnDealIntents.Intent memory c = _intent(
            carol, _list(_erc20(address(usdc), 50 ether)), _list(_erc20(address(weth), 10 ether)), 0
        );

        swap.settle(
            _cycle3(c, a, b), _sigs3(_sign(carolKey, c), _sign(aliceKey, a), _sign(bobKey, b))
        );

        _assertOwner(A1, bob);
        assertEq(usdc.balanceOf(alice), START_TOKEN + 50 ether);
    }
}
