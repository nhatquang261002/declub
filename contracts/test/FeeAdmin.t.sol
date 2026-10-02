// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OnDealV2} from "../src/OnDealV2.sol";
import {OnDealIntents} from "../src/OnDealIntents.sol";
import {IFeeAdmin} from "../src/interfaces/IFeeAdmin.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @dev The fee admin (docs/adr/0018-adjustable-protocol-fee.md), shared by both contracts
///      through `FeeAdmin`. Run once against each, so neither can drift from the other. What a
///      change does to deals is in the two fee suites.
abstract contract FeeAdminTest is Test {
    uint256 internal constant FEE = 2 ether;
    uint256 internal constant MAX = 8 ether;
    uint256 internal constant DELAY = 7 days;

    IFeeAdmin internal target;
    address internal admin = makeAddr("feeAdmin");
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");
    address internal next = makeAddr("next");

    function _deploy(uint256 fee, uint256 maxFee, address recipient, address admin_)
        internal
        virtual
        returns (IFeeAdmin);

    function setUp() public {
        target = _deploy(FEE, MAX, treasury, admin);
    }

    function _notAdmin(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IFeeAdmin.NotFeeAdmin.selector, who);
    }

    // ───────────────────────────────────────────── deploy

    function test_startsWithTheConfiguredValues() public view {
        assertEq(target.fee(), FEE);
        assertEq(target.MAX_FEE(), MAX);
        assertEq(target.FEE_RECIPIENT(), treasury);
        assertEq(target.feeAdmin(), admin);
        assertEq(target.pendingFee(), 0);
        assertEq(target.pendingFeeAt(), 0);
        assertEq(target.pendingFeeAdmin(), address(0));
        assertEq(target.MAX_FEE_LIMIT(), 500 ether);
        assertEq(target.FEE_RAISE_DELAY(), DELAY);
    }

    function test_deployEmitsTheAdmin() public {
        vm.expectEmit(true, true, false, false);
        emit IFeeAdmin.FeeAdminTransferred(address(0), admin);
        _deploy(FEE, MAX, treasury, admin);
    }

    function test_aZeroAdminFixesTheFeeFromTheStart() public {
        IFeeAdmin fixedFee = _deploy(FEE, MAX, treasury, address(0));
        vm.prank(admin);
        vm.expectRevert(_notAdmin(admin));
        fixedFee.setFee(1);
        vm.prank(admin);
        vm.expectRevert(_notAdmin(admin));
        fixedFee.transferFeeAdmin(admin);
    }

    // ───────────────────────────────────────────── cuts apply at once

    function test_aCutAppliesAtOnce() public {
        vm.expectEmit(false, false, false, true, address(target));
        emit IFeeAdmin.FeeChanged(FEE, 1 ether);
        vm.prank(admin);
        target.setFee(1 ether);
        assertEq(target.fee(), 1 ether);
    }

    function test_aCutToZeroAppliesAtOnce() public {
        vm.prank(admin);
        target.setFee(0);
        assertEq(target.fee(), 0);
    }

    function test_aCutDropsAQueuedRaise() public {
        vm.startPrank(admin);
        target.setFee(5 ether);
        target.setFee(1 ether);
        vm.stopPrank();
        assertEq(target.fee(), 1 ether);
        assertEq(target.pendingFee(), 0);
        assertEq(target.pendingFeeAt(), 0);

        vm.warp(block.timestamp + DELAY);
        vm.prank(admin);
        vm.expectRevert(IFeeAdmin.NoPendingFee.selector);
        target.applyFee();
    }

    function test_settingTheSameFeeCancelsAQueuedRaise() public {
        vm.startPrank(admin);
        target.setFee(5 ether);
        target.setFee(FEE);
        vm.stopPrank();
        assertEq(target.fee(), FEE);
        assertEq(target.pendingFeeAt(), 0);
    }

    // ───────────────────────────────────────────── raises wait

    function test_aRaiseIsQueuedNotApplied() public {
        vm.expectEmit(false, false, false, true, address(target));
        emit IFeeAdmin.FeeChangeQueued(5 ether, block.timestamp + DELAY);
        vm.prank(admin);
        target.setFee(5 ether);

        assertEq(target.fee(), FEE);
        assertEq(target.pendingFee(), 5 ether);
        assertEq(target.pendingFeeAt(), block.timestamp + DELAY);
    }

    function test_aRaiseCannotBeAppliedEarly() public {
        vm.prank(admin);
        target.setFee(5 ether);
        uint256 at = block.timestamp + DELAY;

        vm.warp(at - 1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IFeeAdmin.FeeRaiseNotReady.selector, at));
        target.applyFee();
    }

    function test_aRaiseAppliesAfterTheDelay() public {
        vm.prank(admin);
        target.setFee(5 ether);
        vm.warp(block.timestamp + DELAY);

        vm.expectEmit(false, false, false, true, address(target));
        emit IFeeAdmin.FeeChanged(FEE, 5 ether);
        vm.prank(admin);
        target.applyFee();

        assertEq(target.fee(), 5 ether);
        assertEq(target.pendingFee(), 0);
        assertEq(target.pendingFeeAt(), 0);
    }

    function test_aNewRaiseReplacesTheQueuedOneAndRestartsTheClock() public {
        vm.prank(admin);
        target.setFee(5 ether);
        vm.warp(block.timestamp + DELAY - 1);
        vm.prank(admin);
        target.setFee(6 ether);
        uint256 at = block.timestamp + DELAY;
        assertEq(target.pendingFee(), 6 ether);
        assertEq(target.pendingFeeAt(), at);

        vm.warp(block.timestamp + 1); // the first raise's time, not the second's
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IFeeAdmin.FeeRaiseNotReady.selector, at));
        target.applyFee();
    }

    function test_applyWithNothingQueuedReverts() public {
        vm.prank(admin);
        vm.expectRevert(IFeeAdmin.NoPendingFee.selector);
        target.applyFee();
    }

    function test_neverAboveTheCeiling() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IFeeAdmin.FeeTooHigh.selector, MAX + 1, MAX));
        target.setFee(MAX + 1);

        vm.prank(admin);
        target.setFee(MAX); // the ceiling itself is allowed
        assertEq(target.pendingFee(), MAX);
    }

    // ───────────────────────────────────────────── only the admin

    function test_strangersCannotDoAnything() public {
        vm.startPrank(stranger);
        vm.expectRevert(_notAdmin(stranger));
        target.setFee(1);
        vm.expectRevert(_notAdmin(stranger));
        target.applyFee();
        vm.expectRevert(_notAdmin(stranger));
        target.transferFeeAdmin(stranger);
        vm.expectRevert(_notAdmin(stranger));
        target.renounceFeeAdmin();
        vm.stopPrank();
    }

    function test_theRecipientIsNotTheAdmin() public {
        vm.prank(treasury);
        vm.expectRevert(_notAdmin(treasury));
        target.setFee(0);
    }

    // ───────────────────────────────────────────── handover

    function test_handoverTakesTwoSteps() public {
        vm.expectEmit(true, true, false, false, address(target));
        emit IFeeAdmin.FeeAdminTransferStarted(admin, next);
        vm.prank(admin);
        target.transferFeeAdmin(next);
        assertEq(target.feeAdmin(), admin, "nothing changes until accepted");
        assertEq(target.pendingFeeAdmin(), next);

        vm.expectEmit(true, true, false, false, address(target));
        emit IFeeAdmin.FeeAdminTransferred(admin, next);
        vm.prank(next);
        target.acceptFeeAdmin();
        assertEq(target.feeAdmin(), next);
        assertEq(target.pendingFeeAdmin(), address(0));

        vm.prank(admin);
        vm.expectRevert(_notAdmin(admin));
        target.setFee(0);
        vm.prank(next);
        target.setFee(0);
    }

    function test_onlyTheNamedAddressCanAccept() public {
        vm.prank(admin);
        target.transferFeeAdmin(next);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IFeeAdmin.NotPendingFeeAdmin.selector, stranger));
        target.acceptFeeAdmin();
    }

    function test_aHandoverCanBeCancelled() public {
        vm.startPrank(admin);
        target.transferFeeAdmin(next);
        target.transferFeeAdmin(address(0));
        vm.stopPrank();

        vm.prank(next);
        vm.expectRevert(abi.encodeWithSelector(IFeeAdmin.NotPendingFeeAdmin.selector, next));
        target.acceptFeeAdmin();
    }

    function test_nobodyCanAcceptWhenNoHandoverIsOpen() public {
        vm.prank(address(0));
        vm.expectRevert(abi.encodeWithSelector(IFeeAdmin.NotPendingFeeAdmin.selector, address(0)));
        target.acceptFeeAdmin();
    }

    function test_aQueuedRaiseSurvivesAHandover() public {
        vm.prank(admin);
        target.setFee(5 ether);
        vm.prank(admin);
        target.transferFeeAdmin(next);
        vm.prank(next);
        target.acceptFeeAdmin();

        vm.warp(block.timestamp + DELAY);
        vm.prank(next);
        target.applyFee();
        assertEq(target.fee(), 5 ether);
    }

    // ───────────────────────────────────────────── renounce

    function test_renounceFixesTheFeeForGood() public {
        vm.startPrank(admin);
        target.setFee(5 ether);
        target.transferFeeAdmin(next);
        vm.expectEmit(true, true, false, false, address(target));
        emit IFeeAdmin.FeeAdminTransferred(admin, address(0));
        target.renounceFeeAdmin();
        vm.stopPrank();

        assertEq(target.feeAdmin(), address(0));
        assertEq(target.pendingFeeAdmin(), address(0), "the handover is dropped");
        assertEq(target.pendingFee(), 0, "the queued raise is dropped");
        assertEq(target.pendingFeeAt(), 0);
        assertEq(target.fee(), FEE);

        vm.prank(next);
        vm.expectRevert(abi.encodeWithSelector(IFeeAdmin.NotPendingFeeAdmin.selector, next));
        target.acceptFeeAdmin();
        vm.prank(admin);
        vm.expectRevert(_notAdmin(admin));
        target.setFee(0);
    }

    // ───────────────────────────────────────────── fuzz

    /// Whatever the admin does, the fee in force never exceeds the ceiling, and it only goes up
    /// through a raise that waited the full delay.
    function testFuzz_feeStaysUnderTheCeilingAndRaisesWait(uint256[8] memory fees, uint8 waits)
        public
    {
        for (uint256 i; i < fees.length; ++i) {
            uint256 newFee = bound(fees[i], 0, MAX + 1);
            uint256 before = target.fee();
            vm.prank(admin);
            if (newFee > MAX) {
                vm.expectRevert(abi.encodeWithSelector(IFeeAdmin.FeeTooHigh.selector, newFee, MAX));
            }
            target.setFee(newFee);
            if (newFee > before && newFee <= MAX) {
                assertEq(target.fee(), before, "a raise never applies at once");
                if ((waits >> (i % 8)) & 1 == 1) {
                    vm.warp(block.timestamp + DELAY);
                    vm.prank(admin);
                    target.applyFee();
                    assertEq(target.fee(), newFee);
                }
            }
            assertLe(target.fee(), MAX);
        }
    }
}

contract FeeAdminOnDealV2Test is FeeAdminTest {
    function _deploy(uint256 fee, uint256 maxFee, address recipient, address admin_)
        internal
        override
        returns (IFeeAdmin)
    {
        return new OnDealV2(fee, maxFee, recipient, admin_);
    }
}

contract FeeAdminOnDealIntentsTest is FeeAdminTest {
    MockERC20 internal wmon = new MockERC20("Wrapped MON", "WMON");

    function _deploy(uint256 fee, uint256 maxFee, address recipient, address admin_)
        internal
        override
        returns (IFeeAdmin)
    {
        return new OnDealIntents(address(wmon), fee, maxFee, recipient, admin_);
    }
}
