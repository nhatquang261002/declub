// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IDeClubIntents} from "../../src/interfaces/IDeClubIntents.sol";
import {DeClubIntentsBase} from "./DeClubIntentsBase.sol";

contract DeClubIntentsRevertsTest is DeClubIntentsBase {
    IDeClubIntents.Intent[] internal _noCycle;

    // ───────────────────────────────────────────── helpers

    /// @dev A valid alice/bob pair: Chog A1 for 100 USDC, both nonce 0.
    function _pair()
        internal
        view
        returns (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b)
    {
        a = _intent(alice, _list(_chog(A1)), _list(_erc20(address(usdc), 100 ether)), 0);
        b = _intent(bob, _list(_erc20(address(usdc), 100 ether)), _list(_chog(A1)), 0);
    }

    function _settlePair(IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) internal {
        IDeClubIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));
        swap.settle(cycle, sigs);
    }

    function _expectAndSettlePair(
        bytes memory err,
        IDeClubIntents.Intent memory a,
        IDeClubIntents.Intent memory b
    ) internal {
        IDeClubIntents.Intent[] memory cycle = _cycle2(a, b);
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
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        bytes[] memory none = new bytes[](0);

        vm.expectRevert(abi.encodeWithSelector(IDeClubIntents.BadCycleSize.selector, 0));
        swap.settle(_noCycle, none);

        IDeClubIntents.Intent[] memory one = new IDeClubIntents.Intent[](1);
        one[0] = a;
        bytes[] memory oneSig = new bytes[](1);
        oneSig[0] = _sign(aliceKey, a);
        vm.expectRevert(abi.encodeWithSelector(IDeClubIntents.BadCycleSize.selector, 1));
        swap.settle(one, oneSig);

        IDeClubIntents.Intent[] memory five = new IDeClubIntents.Intent[](5);
        bytes[] memory fiveSig = new bytes[](5);
        for (uint256 i; i < 5; ++i) {
            five[i] = i % 2 == 0 ? a : b;
        }
        vm.expectRevert(abi.encodeWithSelector(IDeClubIntents.BadCycleSize.selector, 5));
        swap.settle(five, fiveSig);
    }

    function test_revertsOnSignatureCountMismatch() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        IDeClubIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(aliceKey, a);

        vm.expectRevert(
            abi.encodeWithSelector(IDeClubIntents.SignatureCountMismatch.selector, 2, 1)
        );
        swap.settle(cycle, sigs);
    }

    function test_revertsOnDuplicateMaker() public {
        // alice → bob → alice(second intent): carol is missing, alice signs twice.
        IDeClubIntents.Intent memory a1 =
            _intent(alice, _list(_chog(A1)), _list(_erc20(address(usdc), 10 ether)), 0);
        IDeClubIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(weth), 1 ether)), _list(_chog(A1)), 0);
        IDeClubIntents.Intent memory a2 = _intent(
            alice, _list(_erc20(address(usdc), 10 ether)), _list(_erc20(address(weth), 1 ether)), 1
        );
        IDeClubIntents.Intent[] memory cycle = _cycle3(a1, b, a2);
        bytes[] memory sigs = _sigs3(_sign(aliceKey, a1), _sign(bobKey, b), _sign(aliceKey, a2));

        vm.expectRevert(abi.encodeWithSelector(IDeClubIntents.DuplicateMaker.selector, 2));
        swap.settle(cycle, sigs);
    }

    // ───────────────────────────────────────────── intent fields

    function test_revertsOnZeroMaker() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        a.maker = address(0);
        _expectAndSettlePair(abi.encodeWithSelector(IDeClubIntents.InvalidMaker.selector, 0), a, b);
    }

    function test_revertsOnZeroDeadline() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        b.deadline = 0;
        _expectAndSettlePair(
            abi.encodeWithSelector(IDeClubIntents.InvalidDeadline.selector, 1), a, b
        );
    }

    function test_revertsAfterDeadlineButSettlesAtIt() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        IDeClubIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        vm.warp(uint256(a.deadline) + 1);
        vm.expectRevert(abi.encodeWithSelector(IDeClubIntents.IntentExpired.selector, 0));
        swap.settle(cycle, sigs);

        vm.warp(a.deadline); // still valid at exactly the deadline
        swap.settle(cycle, sigs);
        _assertOwner(A1, bob);
    }

    function test_revertsOnEmptySides() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        a.give = new IDeClubIntents.Asset[](0);
        _expectAndSettlePair(
            abi.encodeWithSelector(IDeClubIntents.EmptySide.selector, 0, true), a, b
        );

        (a, b) = _pair();
        b.want = new IDeClubIntents.Asset[](0);
        _expectAndSettlePair(
            abi.encodeWithSelector(IDeClubIntents.EmptySide.selector, 1, false), a, b
        );
    }

    function test_revertsOnTooManyAssets() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        chog.mint(alice, 10);
        a.give = _chogs(21, 11);
        _expectAndSettlePair(
            abi.encodeWithSelector(IDeClubIntents.TooManyAssets.selector, 0, true, 11), a, b
        );
    }

    function test_revertsOnInvalidAssets() public {
        IDeClubIntents.Asset[] memory bad = new IDeClubIntents.Asset[](1);
        IDeClubIntents.Intent memory a;
        IDeClubIntents.Intent memory b;

        // native
        (a, b) = _pair();
        bad[0] = IDeClubIntents.Asset(IDeClubIntents.AssetType.Native, address(0), 0, 1 ether);
        a.give = bad;
        _expectAndSettlePair(
            abi.encodeWithSelector(IDeClubIntents.InvalidAsset.selector, 0, true, 0), a, b
        );

        // ERC-20 with an id
        (a, b) = _pair();
        bad[0] = IDeClubIntents.Asset(IDeClubIntents.AssetType.ERC20, address(usdc), 1, 1);
        a.want = bad;
        _expectAndSettlePair(
            abi.encodeWithSelector(IDeClubIntents.InvalidAsset.selector, 0, false, 0), a, b
        );

        // ERC-20 with zero amount
        (a, b) = _pair();
        bad[0] = IDeClubIntents.Asset(IDeClubIntents.AssetType.ERC20, address(usdc), 0, 0);
        b.give = bad;
        _expectAndSettlePair(
            abi.encodeWithSelector(IDeClubIntents.InvalidAsset.selector, 1, true, 0), a, b
        );

        // token that isn't a contract
        (a, b) = _pair();
        bad[0] = IDeClubIntents.Asset(IDeClubIntents.AssetType.ERC20, makeAddr("eoa"), 0, 1);
        b.give = bad;
        _expectAndSettlePair(
            abi.encodeWithSelector(IDeClubIntents.InvalidAsset.selector, 1, true, 0), a, b
        );

        // NFT with amount 2
        (a, b) = _pair();
        bad[0] = IDeClubIntents.Asset(IDeClubIntents.AssetType.ERC721, address(chog), 1, 2);
        a.give = bad;
        _expectAndSettlePair(
            abi.encodeWithSelector(IDeClubIntents.InvalidAsset.selector, 0, true, 0), a, b
        );
    }

    function test_revertsOnDuplicateAssetInASide() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        a.give = _list(_chog(A1), _chog(A1));
        _expectAndSettlePair(
            abi.encodeWithSelector(IDeClubIntents.DuplicateAsset.selector, 0, true, 1), a, b
        );
    }

    /// @dev Same token and id, different amount, is still the same asset.
    function test_revertsOnSameErc20TwiceWithDifferentAmounts() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        b.give = _list(_erc20(address(usdc), 100 ether), _erc20(address(usdc), 5 ether));
        _expectAndSettlePair(
            abi.encodeWithSelector(IDeClubIntents.DuplicateAsset.selector, 1, true, 1), a, b
        );
    }

    function test_revertsWhenAnAssetIsOnBothSides() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        a.want = _list(_erc20(address(usdc), 100 ether), _chog(A1));
        _expectAndSettlePair(
            abi.encodeWithSelector(IDeClubIntents.SameAssetBothSides.selector, 0), a, b
        );
    }

    // ───────────────────────────────────────────── want coverage

    function test_revertsWhenWantedNftIsNotGiven() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        b.want = _list(_chog(A2)); // alice gives A1, not A2
        _expectAndSettlePair(abi.encodeWithSelector(IDeClubIntents.WantNotMet.selector, 1, 0), a, b);
        _assertUntouched();
    }

    function test_revertsWhenGivenAmountIsBelowWant() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        a.want = _list(_erc20(address(usdc), 100 ether + 1));
        _expectAndSettlePair(abi.encodeWithSelector(IDeClubIntents.WantNotMet.selector, 0, 0), a, b);
    }

    function test_revertsWhenWantedTokenIsNotGiven() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        a.want = _list(_erc20(address(weth), 100 ether));
        _expectAndSettlePair(abi.encodeWithSelector(IDeClubIntents.WantNotMet.selector, 0, 0), a, b);
    }

    function test_revertsWhenOneOfSeveralWantsIsMissing() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        a.want = _list(_erc20(address(usdc), 100 ether), _erc20(address(weth), 1 ether));
        _expectAndSettlePair(abi.encodeWithSelector(IDeClubIntents.WantNotMet.selector, 0, 1), a, b);
    }

    /// @dev In a ring a want is covered by the *previous* maker only, not by anyone else.
    function test_ringWantMustBeCoveredByThePreviousMakerOnly() public {
        // carol gives USDC, but bob (not carol) precedes alice... order: alice → bob → carol.
        IDeClubIntents.Intent memory a =
            _intent(alice, _list(_chog(A1)), _list(_erc20(address(usdc), 5 ether)), 0);
        IDeClubIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(weth), 1 ether)), _list(_chog(A1)), 0);
        IDeClubIntents.Intent memory c =
            _intent(carol, _list(_erc20(address(usdc), 5 ether)), _list(_chog(A1)), 0);
        // carol's want (A1) is only given by alice, who is not carol's predecessor (bob is).
        IDeClubIntents.Intent[] memory cycle = _cycle3(a, b, c);
        bytes[] memory sigs = _sigs3(_sign(aliceKey, a), _sign(bobKey, b), _sign(carolKey, c));

        vm.expectRevert(abi.encodeWithSelector(IDeClubIntents.WantNotMet.selector, 2, 0));
        swap.settle(cycle, sigs);
    }

    // ───────────────────────────────────────────── transfer failures are atomic

    function test_revertsWhenMakerMovedTheAsset() public {
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        IDeClubIntents.Intent[] memory cycle = _cycle2(a, b);
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
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        IDeClubIntents.Intent[] memory cycle = _cycle2(a, b);
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
        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        IDeClubIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        vm.prank(bob);
        usdc.transfer(carol, START_TOKEN - 50 ether);

        vm.expectRevert();
        swap.settle(cycle, sigs);
        _assertOwner(A1, alice);
    }

    /// @dev A failure on the last leg of a ring undoes every earlier leg and every nonce.
    function test_failedRingChangesNothing() public {
        IDeClubIntents.Intent memory a =
            _intent(alice, _list(_chog(A1)), _list(_erc20(address(usdc), 50 ether)), 0);
        IDeClubIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(weth), 10 ether)), _list(_chog(A1)), 0);
        IDeClubIntents.Intent memory c = _intent(
            carol, _list(_erc20(address(usdc), 50 ether)), _list(_erc20(address(weth), 10 ether)), 0
        );
        IDeClubIntents.Intent[] memory cycle = _cycle3(a, b, c);
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

        (IDeClubIntents.Intent memory a, IDeClubIntents.Intent memory b) = _pair();
        _settlePair(a, b);

        _assertOwner(A1, bob);
    }

    function test_perTokenApprovalDoesNotCoverOtherTokens() public {
        vm.startPrank(alice);
        chog.setApprovalForAll(address(swap), false);
        chog.approve(address(swap), A1);
        vm.stopPrank();

        // alice's intent gives A2, which the contract was never approved for.
        IDeClubIntents.Intent memory a =
            _intent(alice, _list(_chog(A2)), _list(_erc20(address(usdc), 100 ether)), 0);
        IDeClubIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(usdc), 100 ether)), _list(_chog(A2)), 0);
        IDeClubIntents.Intent[] memory cycle = _cycle2(a, b);
        bytes[] memory sigs = _sigs2(_sign(aliceKey, a), _sign(bobKey, b));

        vm.expectRevert();
        swap.settle(cycle, sigs);
        _assertOwner(A2, alice);
    }
}
