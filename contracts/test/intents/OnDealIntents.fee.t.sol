// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {OnDealIntents} from "../../src/OnDealIntents.sol";
import {IOnDealIntents} from "../../src/interfaces/IOnDealIntents.sol";
import {IFeeAdmin} from "../../src/interfaces/IFeeAdmin.sol";
import {OnDealIntentsBase} from "./OnDealIntentsBase.sol";

/// @dev The protocol fee (docs/adr/0015-protocol-fee.md, docs/adr/0018-adjustable-protocol-fee.md):
///      every maker in a settled cycle pays `fee()` of `FEE_TOKEN` (WMON) from their wallet to
///      the recipient, the intent signs the most it will pay (`maxFee`), and a cycle that
///      doesn't settle charges nobody. The fixture deploys with 2 WMON (ceiling 8). The admin
///      functions themselves are in `FeeAdmin.t.sol`.
contract OnDealIntentsFeeTest is OnDealIntentsBase {
    uint256 internal constant FEE = 2 ether;

    function _feeAmount() internal pure override returns (uint256) {
        return FEE;
    }

    function _pair()
        internal
        view
        returns (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs)
    {
        return _chogForUsdc(100 ether, 100 ether, 0, 0);
    }

    // ───────────────────────────────────────────── constructor

    function test_exposesTheFeeSettings() public view {
        assertEq(swap.FEE_TOKEN(), address(wmon));
        assertEq(swap.fee(), FEE);
        assertEq(swap.FEE_RECIPIENT(), treasury);
        assertEq(swap.MAX_FEE(), 4 * FEE);
        assertEq(swap.feeAdmin(), feeAdmin);
    }

    function test_constructorRefusesACeilingAboveTheLimit() public {
        vm.expectRevert(
            abi.encodeWithSelector(IFeeAdmin.FeeTooHigh.selector, 500 ether + 1, 500 ether)
        );
        new OnDealIntents(address(wmon), 0, 500 ether + 1, treasury, feeAdmin);
    }

    function test_constructorRefusesAFeeAboveTheCeiling() public {
        vm.expectRevert(abi.encodeWithSelector(IFeeAdmin.FeeTooHigh.selector, 3 ether, 2 ether));
        new OnDealIntents(address(wmon), 3 ether, 2 ether, treasury, feeAdmin);
    }

    function test_constructorAcceptsTheLimitExactly() public {
        OnDealIntents s = new OnDealIntents(address(wmon), 500 ether, 500 ether, treasury, feeAdmin);
        assertEq(s.fee(), 500 ether);
    }

    function test_constructorRefusesACeilingWithoutARecipient() public {
        vm.expectRevert(IFeeAdmin.NoFeeRecipient.selector);
        new OnDealIntents(address(wmon), 0, 1, address(0), feeAdmin);
    }

    function test_constructorRefusesAFeeTokenThatIsNotAContract() public {
        vm.expectRevert(abi.encodeWithSelector(IOnDealIntents.InvalidFeeToken.selector, alice));
        new OnDealIntents(alice, 1, 1, treasury, feeAdmin);
        // A ceiling alone needs the token: the fee could be raised to it later.
        vm.expectRevert(abi.encodeWithSelector(IOnDealIntents.InvalidFeeToken.selector, address(0)));
        new OnDealIntents(address(0), 0, 1, treasury, feeAdmin);
    }

    function test_constructorAllowsNoFeeAtAll() public {
        OnDealIntents free = new OnDealIntents(address(0), 0, 0, address(0), address(0));
        assertEq(free.fee(), 0);
    }

    // ───────────────────────────────────────────── charged on settlement

    function test_everyMakerInAPairPaysTheFee() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) = _pair();

        vm.expectEmit(true, true, false, true, address(swap));
        emit IOnDealIntents.FeeCharged(treasury, address(wmon), 2 * FEE);
        swap.settle(cycle, sigs);

        assertEq(wmon.balanceOf(treasury), 2 * FEE);
        assertEq(wmon.balanceOf(alice), START_TOKEN - FEE);
        assertEq(wmon.balanceOf(bob), START_TOKEN - FEE);
        assertEq(wmon.balanceOf(address(swap)), 0);
        _assertOwner(A1, bob);
        assertEq(usdc.balanceOf(alice), START_TOKEN + 100 ether);
    }

    function test_everyMakerInARingPays() public {
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

        assertEq(wmon.balanceOf(treasury), 3 * FEE);
        assertEq(wmon.balanceOf(alice), START_TOKEN - FEE);
        assertEq(wmon.balanceOf(bob), START_TOKEN - FEE);
        assertEq(wmon.balanceOf(carol), START_TOKEN - FEE);
        assertEq(wmon.balanceOf(dave), START_TOKEN); // not in the cycle
    }

    function test_aFourWayRingPaysFourFees() public {
        IOnDealIntents.Intent[] memory cycle = new IOnDealIntents.Intent[](4);
        cycle[0] = _intent(alice, _list(_chog(A1)), _list(_chog(D1)), 0);
        cycle[1] = _intent(bob, _list(_chog(B1)), _list(_chog(A1)), 0);
        cycle[2] = _intent(carol, _list(_chog(C1)), _list(_chog(B1)), 0);
        cycle[3] = _intent(dave, _list(_chog(D1)), _list(_chog(C1)), 0);
        uint256[] memory keys = new uint256[](4);
        (keys[0], keys[1], keys[2], keys[3]) = (aliceKey, bobKey, carolKey, daveKey);
        swap.settle(cycle, _signAll(cycle, keys));

        assertEq(wmon.balanceOf(treasury), 4 * FEE);
    }

    function test_aMakerWhoAlsoGivesWmonPaysTheFeeOnTop() public {
        IOnDealIntents.Intent memory a =
            _intent(alice, _list(_chog(A1)), _list(_erc20(address(wmon), 10 ether)), 0);
        IOnDealIntents.Intent memory b =
            _intent(bob, _list(_erc20(address(wmon), 10 ether)), _list(_chog(A1)), 0);
        swap.settle(_cycle2(a, b), _sigs2(_sign(aliceKey, a), _sign(bobKey, b)));

        assertEq(wmon.balanceOf(alice), START_TOKEN + 10 ether - FEE);
        assertEq(wmon.balanceOf(bob), START_TOKEN - 10 ether - FEE);
        assertEq(wmon.balanceOf(treasury), 2 * FEE);
    }

    // ───────────────────────────────────────────── the signed fee is a maximum

    function _unsignedWith(address feeToken, uint256 maxFee)
        internal
        view
        returns (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs)
    {
        (cycle, sigs) = _pair();
        // Alice signs a fee of her own choosing.
        cycle[0].feeToken = feeToken;
        cycle[0].maxFee = maxFee;
        sigs[0] = _sign(aliceKey, cycle[0]);
    }

    function test_revertsWhenTheSignedFeeIsLower() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) =
            _unsignedWith(address(wmon), FEE - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IOnDealIntents.WrongFee.selector, 0, address(wmon), FEE - 1)
        );
        swap.settle(cycle, sigs);
    }

    function test_aHigherSignedMaxFeeSettlesAndPaysOnlyTheFee() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) =
            _unsignedWith(address(wmon), FEE + 1 ether);
        uint256 before = wmon.balanceOf(alice);
        swap.settle(cycle, sigs);
        assertEq(wmon.balanceOf(alice), before - FEE);
        assertEq(wmon.balanceOf(treasury), 2 * FEE);
    }

    function test_revertsWhenTheSignedFeeIsZero() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) =
            _unsignedWith(address(wmon), 0);
        vm.expectRevert(
            abi.encodeWithSelector(IOnDealIntents.WrongFee.selector, 0, address(wmon), 0)
        );
        swap.settle(cycle, sigs);
    }

    function test_revertsWhenTheSignedFeeTokenIsAnother() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) =
            _unsignedWith(address(usdc), FEE);
        vm.expectRevert(
            abi.encodeWithSelector(IOnDealIntents.WrongFee.selector, 0, address(usdc), FEE)
        );
        swap.settle(cycle, sigs);
    }

    /// @dev An intent built for a fee-free deployment (fee 0, no token) can't be used here.
    function test_anIntentFromAFeeFreeDeploymentIsRefused() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) = _unsignedWith(address(0), 0);
        vm.expectRevert(
            abi.encodeWithSelector(IOnDealIntents.WrongFee.selector, 0, address(0), 0)
        );
        swap.settle(cycle, sigs);
    }

    function test_theFeeIsCheckedOnEveryMakerNotJustTheFirst() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) = _pair();
        cycle[1].maxFee = FEE - 5;
        sigs[1] = _sign(bobKey, cycle[1]);
        vm.expectRevert(
            abi.encodeWithSelector(IOnDealIntents.WrongFee.selector, 1, address(wmon), FEE - 5)
        );
        swap.settle(cycle, sigs);
    }

    // ───────────────────────────────────────────── the fee admin changes the fee

    function test_aCutKeepsSignedIntentsValidAndChargesTheNewFee() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) = _pair(); // signed at FEE
        vm.prank(feeAdmin);
        swap.setFee(0.5 ether);

        uint256 before = wmon.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(swap));
        emit IOnDealIntents.FeeCharged(treasury, address(wmon), 2 * 0.5 ether);
        swap.settle(cycle, sigs);
        assertEq(wmon.balanceOf(alice), before - 0.5 ether);
        assertEq(wmon.balanceOf(treasury), 1 ether);
    }

    function test_aCutToZeroSettlesWithoutAFee() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) = _pair();
        vm.prank(feeAdmin);
        swap.setFee(0);
        swap.settle(cycle, sigs);
        assertEq(wmon.balanceOf(treasury), 0);
    }

    function test_aQueuedRaiseChangesNothingUntilApplied() public {
        vm.prank(feeAdmin);
        swap.setFee(3 ether);
        vm.warp(block.timestamp + swap.FEE_RAISE_DELAY());
        // Not applied yet: intents signed now still carry, and settle at, FEE.
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) = _pair();
        assertEq(cycle[0].maxFee, FEE);
        swap.settle(cycle, sigs);
        assertEq(wmon.balanceOf(treasury), 2 * FEE);
    }

    function test_anAppliedRaiseMakesIntentsSignedBelowItStale() public {
        vm.prank(feeAdmin);
        swap.setFee(3 ether);
        vm.warp(block.timestamp + swap.FEE_RAISE_DELAY());
        // Signed while the raise waits, at the fee then in force.
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) = _pair();
        vm.prank(feeAdmin);
        swap.applyFee();

        vm.expectRevert(
            abi.encodeWithSelector(IOnDealIntents.WrongFee.selector, 0, address(wmon), FEE)
        );
        swap.settle(cycle, sigs);

        // Signed again at the new fee, the same deal settles.
        cycle[0].maxFee = 3 ether;
        cycle[1].maxFee = 3 ether;
        sigs[0] = _sign(aliceKey, cycle[0]);
        sigs[1] = _sign(bobKey, cycle[1]);
        swap.settle(cycle, sigs);
        assertEq(wmon.balanceOf(treasury), 6 ether);
    }

    // ───────────────────────────────────────────── no deal, no fee

    function test_aMakerWithoutWmonRevertsTheWholeCycle() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) = _pair();
        vm.prank(bob);
        require(wmon.transfer(carol, START_TOKEN)); // bob's WMON is gone

        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, bob, 0, FEE)
        );
        swap.settle(cycle, sigs);

        _assertOwner(A1, alice); // nothing moved
        assertEq(usdc.balanceOf(bob), START_TOKEN);
        assertEq(wmon.balanceOf(treasury), 0);
        assertFalse(swap.isNonceUsed(alice, 0)); // and the nonces are still unspent
    }

    function test_aMakerWhoRevokedTheWmonApprovalRevertsTheWholeCycle() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) = _pair();
        vm.prank(alice);
        wmon.approve(address(swap), 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(swap), 0, FEE
            )
        );
        swap.settle(cycle, sigs);

        _assertOwner(A1, alice);
        assertEq(wmon.balanceOf(treasury), 0);
        assertEq(wmon.balanceOf(bob), START_TOKEN);
    }

    function test_aCycleThatFailsForAnotherReasonChargesNobody() public {
        // Bob offers too little USDC for alice's want.
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) =
            _chogForUsdc(100 ether, 99 ether, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(IOnDealIntents.WantNotMet.selector, 0, 0));
        swap.settle(cycle, sigs);

        assertEq(wmon.balanceOf(treasury), 0);
        assertEq(wmon.balanceOf(alice), START_TOKEN);
        assertEq(wmon.balanceOf(bob), START_TOKEN);
    }

    function test_anExpiredOrReusedIntentChargesNobody() public {
        (IOnDealIntents.Intent[] memory cycle, bytes[] memory sigs) = _pair();
        swap.settle(cycle, sigs);
        assertEq(wmon.balanceOf(treasury), 2 * FEE);

        // Replaying the same signed cycle reverts on the nonce, before any fee moves.
        vm.expectRevert(abi.encodeWithSelector(IOnDealIntents.NonceUsed.selector, alice, 0));
        swap.settle(cycle, sigs);
        assertEq(wmon.balanceOf(treasury), 2 * FEE);
    }

    // ───────────────────────────────────────────── zero fee

    function test_aZeroFeeDeploymentChargesAndEmitsNothing() public {
        OnDealIntents free = new OnDealIntents(address(0), 0, 0, address(0), address(0));
        vm.startPrank(alice);
        chog.setApprovalForAll(address(free), true);
        vm.stopPrank();
        vm.startPrank(bob);
        usdc.approve(address(free), type(uint256).max);
        vm.stopPrank();

        IOnDealIntents.Intent memory a = IOnDealIntents.Intent(
            alice,
            _list(_chog(A1)),
            _list(_erc20(address(usdc), 1 ether)),
            address(0),
            0,
            _deadline(),
            0
        );
        IOnDealIntents.Intent memory b = IOnDealIntents.Intent(
            bob,
            _list(_erc20(address(usdc), 1 ether)),
            _list(_chog(A1)),
            address(0),
            0,
            _deadline(),
            0
        );
        (uint8 va, bytes32 ra, bytes32 sa) = vm.sign(aliceKey, free.intentDigest(a));
        (uint8 vb, bytes32 rb, bytes32 sb) = vm.sign(bobKey, free.intentDigest(b));

        vm.recordLogs();
        free.settle(
            _cycle2(a, b), _sigs2(abi.encodePacked(ra, sa, va), abi.encodePacked(rb, sb, vb))
        );

        _assertOwner(A1, bob);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(
                logs[i].topics[0] != IOnDealIntents.FeeCharged.selector, "FeeCharged emitted"
            );
        }
    }

    // ───────────────────────────────────────────── fuzz

    /// A settlement moves exactly `n × fee` of WMON into the recipient and the contract keeps none.
    function testFuzz_feeScalesWithTheCycle(uint256 fee) public {
        fee = bound(fee, 1, 500 ether);
        OnDealIntents s = new OnDealIntents(address(wmon), fee, fee, treasury, address(0));
        address[2] memory who = [alice, bob];
        for (uint256 i; i < 2; ++i) {
            vm.startPrank(who[i]);
            chog.setApprovalForAll(address(s), true);
            usdc.approve(address(s), type(uint256).max);
            wmon.approve(address(s), type(uint256).max);
            vm.stopPrank();
        }
        IOnDealIntents.Intent memory a = IOnDealIntents.Intent(
            alice,
            _list(_chog(A1)),
            _list(_erc20(address(usdc), 1 ether)),
            address(wmon),
            fee,
            _deadline(),
            0
        );
        IOnDealIntents.Intent memory b = IOnDealIntents.Intent(
            bob,
            _list(_erc20(address(usdc), 1 ether)),
            _list(_chog(A1)),
            address(wmon),
            fee,
            _deadline(),
            0
        );
        (uint8 va, bytes32 ra, bytes32 sa) = vm.sign(aliceKey, s.intentDigest(a));
        (uint8 vb, bytes32 rb, bytes32 sb) = vm.sign(bobKey, s.intentDigest(b));

        s.settle(_cycle2(a, b), _sigs2(abi.encodePacked(ra, sa, va), abi.encodePacked(rb, sb, vb)));

        assertEq(wmon.balanceOf(treasury), 2 * fee);
        assertEq(wmon.balanceOf(address(s)), 0);
    }
}
