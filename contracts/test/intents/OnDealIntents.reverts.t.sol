// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IOnDealIntents} from "../../src/interfaces/IOnDealIntents.sol";
import {OnDealIntentsBase} from "./OnDealIntentsBase.sol";

contract OnDealIntentsRevertsTest is OnDealIntentsBase {
    IOnDealIntents.Intent[] internal _noCycle;

    // ───────────────────────────────────────────── helpers

    /// @dev A valid alice/bob pair: Chog A1 for 100 USDC, both nonce 0.
    function _pair()
        internal
        view
        returns (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b)
    {
        a = _intent(alice, _list(_chog(A1)), _list(_erc20(address(usdc), 100 ether)), 0);
        b = _intent(bob, _list(_erc20(address(usdc), 100 ether)), _list(_chog(A1)), 0);
    }

    function _settlePair(IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b)
        internal
    {
        IOnDealIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));
        swap.settle(cycle, sigs);
    }

    function _expectAndSettlePair(
        bytes memory err,
        IOnDealIntents.Intent memory a,
        IOnDealIntents.Intent memory b
    ) internal {
        IOnDealIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));
        vm.expectRevert(err);
        swap.settle(cycle, sigs);
    }

    function _assertUntouched() internal view {
        _assertOwner(A1, alice);
        assertEq(usdc.balanceOf(alice), START_TOKEN);
        assertEq(usdc.balanceOf(bob), START_TOKEN);
    }

    // ───────────────────────────────────────────── cycle shape

    function test_revertsOnEmptyOrSingleOrOversizedCycle() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        bytes[] memory none = new bytes[](0);

        vm.expectRevert(abi.encodeWithSelector(IOnDealIntents.BadCycleSize.selector, 0));
        swap.settle(_noCycle, none);

        IOnDealIntents.Intent[] memory one = new IOnDealIntents.Intent[](1);
        one[0] = a;
        bytes[] memory oneSig = new bytes[](1);
        oneSig[0] = _sign(aliceKey, a);
        vm.expectRevert(abi.encodeWithSelector(IOnDealIntents.BadCycleSize.selector, 1));
        swap.settle(one, oneSig);

        IOnDealIntents.Intent[] memory five = new IOnDealIntents.Intent[](5);
        bytes[] memory fiveSig = new bytes[](5);
        for (uint256 i; i < 5; ++i) {
            five[i] = i % 2 == 0 ? a : b;
        }
        vm.expectRevert(abi.encodeWithSelector(IOnDealIntents.BadCycleSize.selector, 5));
        swap.settle(five, fiveSig);
    }

    function test_revertsOnSignatureCountMismatch() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        IOnDealIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(aliceKey, a);

        vm.expectRevert(
            abi.encodeWithSelector(IOnDealIntents.SignatureCountMismatch.selector, 2, 1)
        );
        swap.settle(cycle, sigs);
    }

    function test_revertsOnDuplicateMaker() public {
        // alice → bob → alice(second intent): carol is missing, alice signs twice.
        IOnDealIntents.Intent memory a1 =
            _intent(alice, _list(_chog(A1)), _list(_erc20(address(usdc), 10 ether)), 0);
        IOnDealIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(weth), 1 ether)), _list(_chog(A1)), 0);
        IOnDealIntents.Intent memory a2 = _intent(
            alice, _list(_erc20(address(usdc), 10 ether)), _list(_erc20(address(weth), 1 ether)), 1
        );
        IOnDealIntents.Intent[] memory cycle = _cycle3(a1, b, a2);
        bytes[] memory sigs = _sigs3(_sign(aliceKey, a1), _sign(bobKey, b), _sign(aliceKey, a2));

        vm.expectRevert(abi.encodeWithSelector(IOnDealIntents.DuplicateMaker.selector, 2));
        swap.settle(cycle, sigs);
    }

    // ───────────────────────────────────────────── intent fields

    function test_revertsOnZeroMaker() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        a.maker = address(0);
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.InvalidMaker.selector, 0), a, b
        );
    }

    function test_revertsOnZeroDeadline() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        b.deadline = 0;
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.InvalidDeadline.selector, 1), a, b
        );
    }

    function test_revertsAfterDeadlineButSettlesAtIt() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        IOnDealIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        vm.warp(uint256(a.deadline) + 1);
        vm.expectRevert(abi.encodeWithSelector(IOnDealIntents.IntentExpired.selector, 0));
        swap.settle(cycle, sigs);

        vm.warp(a.deadline); // still valid at exactly the deadline
        swap.settle(cycle, sigs);
        _assertOwner(A1, bob);
    }

    function test_revertsOnEmptySides() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        a.give = new IOnDealIntents.Asset[](0);
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.EmptySide.selector, 0, true), a, b
        );

        (a, b) = _pair();
        b.want = new IOnDealIntents.Asset[](0);
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.EmptySide.selector, 1, false), a, b
        );
    }

    function test_revertsOnTooManyAssets() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        chog.mint(alice, 10);
        a.give = _chogs(21, 11);
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.TooManyAssets.selector, 0, true, 11), a, b
        );
    }

    function test_revertsOnInvalidAssets() public {
        IOnDealIntents.Asset[] memory bad = new IOnDealIntents.Asset[](1);
        IOnDealIntents.Intent memory a;
        IOnDealIntents.Intent memory b;

        // native
        (a, b) = _pair();
        bad[0] = IOnDealIntents.Asset(IOnDealIntents.AssetType.Native, address(0), 0, 1 ether);
        a.give = bad;
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.InvalidAsset.selector, 0, true, 0), a, b
        );

        // ERC-20 with an id
        (a, b) = _pair();
        bad[0] = IOnDealIntents.Asset(IOnDealIntents.AssetType.ERC20, address(usdc), 1, 1);
        a.want = bad;
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.InvalidAsset.selector, 0, false, 0), a, b
        );

        // ERC-20 with zero amount
        (a, b) = _pair();
        bad[0] = IOnDealIntents.Asset(IOnDealIntents.AssetType.ERC20, address(usdc), 0, 0);
        b.give = bad;
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.InvalidAsset.selector, 1, true, 0), a, b
        );

        // token that isn't a contract
        (a, b) = _pair();
        bad[0] = IOnDealIntents.Asset(IOnDealIntents.AssetType.ERC20, makeAddr("eoa"), 0, 1);
        b.give = bad;
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.InvalidAsset.selector, 1, true, 0), a, b
        );

        // NFT with amount 2
        (a, b) = _pair();
        bad[0] = IOnDealIntents.Asset(IOnDealIntents.AssetType.ERC721, address(chog), 1, 2);
        a.give = bad;
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.InvalidAsset.selector, 0, true, 0), a, b
        );
    }

    function test_revertsOnDuplicateAssetInASide() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        a.give = _list(_chog(A1), _chog(A1));
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.DuplicateAsset.selector, 0, true, 1), a, b
        );
    }

    /// @dev Same token and id, different amount, is still the same asset.
    function test_revertsOnSameErc20TwiceWithDifferentAmounts() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        b.give = _list(_erc20(address(usdc), 100 ether), _erc20(address(usdc), 5 ether));
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.DuplicateAsset.selector, 1, true, 1), a, b
        );
    }

    function test_revertsWhenAnAssetIsOnBothSides() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        a.want = _list(_erc20(address(usdc), 100 ether), _chog(A1));
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.SameAssetBothSides.selector, 0), a, b
        );
    }

    // ───────────────────────────────────────────── want coverage

    function test_revertsWhenWantedNftIsNotGiven() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        b.want = _list(_chog(A2)); // alice gives A1, not A2
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.WantNotMet.selector, 1, 0), a, b
        );
        _assertUntouched();
    }

    function test_revertsWhenGivenAmountIsBelowWant() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        a.want = _list(_erc20(address(usdc), 100 ether + 1));
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.WantNotMet.selector, 0, 0), a, b
        );
    }

    function test_revertsWhenWantedTokenIsNotGiven() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        a.want = _list(_erc20(address(weth), 100 ether));
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.WantNotMet.selector, 0, 0), a, b
        );
    }

    function test_revertsWhenOneOfSeveralWantsIsMissing() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        a.want = _list(_erc20(address(usdc), 100 ether), _erc20(address(weth), 1 ether));
        _expectAndSettlePair(
            abi.encodeWithSelector(IOnDealIntents.WantNotMet.selector, 0, 1), a, b
        );
    }

    /// @dev In a ring a want is covered by the *previous* maker only, not by anyone else.
    function test_ringWantMustBeCoveredByThePreviousMakerOnly() public {
        // carol gives USDC, but bob (not carol) precedes alice... order: alice → bob → carol.
        IOnDealIntents.Intent memory a =
            _intent(alice, _list(_chog(A1)), _list(_erc20(address(usdc), 5 ether)), 0);
        IOnDealIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(weth), 1 ether)), _list(_chog(A1)), 0);
        IOnDealIntents.Intent memory c =
            _intent(carol, _list(_erc20(address(usdc), 5 ether)), _list(_chog(A1)), 0);
        // carol's want (A1) is only given by alice, who is not carol's predecessor (bob is).
        IOnDealIntents.Intent[] memory cycle = _cycle3(a, b, c);
        bytes[] memory sigs = _sigs3(_sign(aliceKey, a), _sign(bobKey, b), _sign(carolKey, c));

        vm.expectRevert(abi.encodeWithSelector(IOnDealIntents.WantNotMet.selector, 2, 0));
        swap.settle(cycle, sigs);
    }

    // ───────────────────────────────────────────── transfer failures are atomic

    function test_revertsWhenMakerMovedTheAsset() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        IOnDealIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        vm.prank(alice);
        chog.transferFrom(alice, carol, A1);

        vm.expectRevert();
        swap.settle(cycle, sigs);

        assertEq(usdc.balanceOf(bob), START_TOKEN);
        assertFalse(swap.isNonceUsed(alice, 0));
        assertFalse(swap.isNonceUsed(bob, 0));
    }

    function test_revertsWhenApprovalIsRevoked() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        IOnDealIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        vm.prank(bob);
        usdc.approve(address(swap), 99 ether);

        vm.expectRevert();
        swap.settle(cycle, sigs);
        _assertUntouched();

        vm.prank(bob);
        usdc.approve(address(swap), 100 ether);
        swap.settle(cycle, sigs);
        _assertOwner(A1, bob);
    }

    function test_revertsWhenMakerLacksTheBalance() public {
        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        IOnDealIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        vm.prank(bob);
        usdc.transfer(carol, START_TOKEN - 50 ether);

        vm.expectRevert();
        swap.settle(cycle, sigs);
        _assertOwner(A1, alice);
    }

    /// @dev A failure on the last leg of a ring undoes every earlier leg and every nonce.
    function test_failedRingChangesNothing() public {
        IOnDealIntents.Intent memory a =
            _intent(alice, _list(_chog(A1)), _list(_erc20(address(usdc), 50 ether)), 0);
        IOnDealIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(weth), 10 ether)), _list(_chog(A1)), 0);
        IOnDealIntents.Intent memory c = _intent(
            carol, _list(_erc20(address(usdc), 50 ether)), _list(_erc20(address(weth), 10 ether)), 0
        );
        IOnDealIntents.Intent[] memory cycle = _cycle3(a, b, c);
        bytes[] memory sigs = _sigs3(_sign(aliceKey, a), _sign(bobKey, b), _sign(carolKey, c));

        vm.prank(carol);
        usdc.approve(address(swap), 0); // carol's leg is the last to run

        vm.expectRevert();
        swap.settle(cycle, sigs);

        _assertOwner(A1, alice);
        assertEq(weth.balanceOf(bob), START_TOKEN);
        assertEq(weth.balanceOf(carol), START_TOKEN);
        assertFalse(swap.isNonceUsed(alice, 0));
        assertFalse(swap.isNonceUsed(bob, 0));
        assertFalse(swap.isNonceUsed(carol, 0));
    }

    /// @dev A narrow per-token NFT approval is enough; no collection-wide approval is required.
    function test_worksWithPerTokenNftApproval() public {
        vm.startPrank(alice);
        chog.setApprovalForAll(address(swap), false);
        chog.approve(address(swap), A1);
        vm.stopPrank();

        (IOnDealIntents.Intent memory a, IOnDealIntents.Intent memory b) = _pair();
        _settlePair(a, b);

        _assertOwner(A1, bob);
    }

    function test_perTokenApprovalDoesNotCoverOtherTokens() public {
        vm.startPrank(alice);
        chog.setApprovalForAll(address(swap), false);
        chog.approve(address(swap), A1);
        vm.stopPrank();

        // alice's intent gives A2, which the contract was never approved for.
        IOnDealIntents.Intent memory a =
            _intent(alice, _list(_chog(A2)), _list(_erc20(address(usdc), 100 ether)), 0);
        IOnDealIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(usdc), 100 ether)), _list(_chog(A2)), 0);
        IOnDealIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        vm.expectRevert();
        swap.settle(cycle, sigs);
        _assertOwner(A2, alice);
    }
}
