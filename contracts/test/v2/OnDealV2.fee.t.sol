// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OnDealV2} from "../../src/OnDealV2.sol";
import {IOnDealV2} from "../../src/interfaces/IOnDealV2.sol";
import {OnDealV2Base} from "./OnDealV2Base.sol";
import {MonReceiver, ReentrantReceiver} from "../utils/Actors.sol";

/// @dev The protocol fee (docs/adr/0015-protocol-fee.md): every side sends FEE with its own call,
///      the escrow holds it, and it is released to the recipient only when the deal completes and
///      refunded otherwise. The fixture deploys with a 2 MON fee, so a completed deal pays 4.
contract OnDealV2FeeTest is OnDealV2Base {
    uint256 internal constant FEE = 2 ether;
    IOnDealV2.AssetType internal constant NATIVE = IOnDealV2.AssetType.Native;

    function _fee() internal pure override returns (uint256) {
        return FEE;
    }

    function _wrongAmount(uint256 expected, uint256 sent) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IOnDealV2.WrongNativeAmount.selector, expected, sent);
    }

    /// @dev A one-leaf Merkle set: the root is the leaf, so the proof is empty.
    function _traitAsset(uint256 id) internal view returns (IOnDealV2.Asset memory) {
        bytes32 root = keccak256(abi.encode(address(chog), id));
        return IOnDealV2.Asset(IOnDealV2.AssetType.ERC721Trait, address(chog), uint256(root), 1);
    }

    function _fillFor(uint256 id) internal pure returns (IOnDealV2.TraitFill[] memory fills) {
        fills = new IOnDealV2.TraitFill[](1);
        fills[0].tokenIds = new uint256[](1);
        fills[0].tokenIds[0] = id;
        fills[0].proofs = new bytes32[][](1);
        fills[0].proofs[0] = new bytes32[](0);
    }

    // ───────────────────────────────────────────── constructor

    function test_exposesTheFeeAndTheRecipient() public view {
        assertEq(swap.FEE(), FEE);
        assertEq(swap.FEE_RECIPIENT(), treasury);
        assertEq(swap.MAX_FEE(), 500 ether);
    }

    function test_constructorRefusesAFeeAboveTheCeiling() public {
        vm.expectRevert(
            abi.encodeWithSelector(IOnDealV2.FeeTooHigh.selector, 500 ether + 1, 500 ether)
        );
        new OnDealV2(500 ether + 1, treasury);
    }

    function test_constructorAcceptsTheCeilingExactly() public {
        assertEq(new OnDealV2(500 ether, treasury).FEE(), 500 ether);
    }

    function test_constructorRefusesAFeeWithoutARecipient() public {
        vm.expectRevert(IOnDealV2.NoFeeRecipient.selector);
        new OnDealV2(1, address(0));
    }

    function test_constructorAllowsNoFeeAndNoRecipient() public {
        OnDealV2 free = new OnDealV2(0, address(0));
        assertEq(free.FEE(), 0);
        assertEq(free.FEE_RECIPIENT(), address(0));
    }

    // ───────────────────────────────────────────── exact value on every payable entry

    function test_createTradeNeedsTheNativeAmountPlusFee() public {
        IOnDealV2.Asset[] memory offered = _list(_native(3 ether));
        IOnDealV2.Asset[] memory requested = _list(_chog(B1));

        vm.startPrank(alice);
        vm.expectRevert(_wrongAmount(3 ether + FEE, 3 ether)); // forgot the fee
        swap.createTrade{value: 3 ether}(offered, requested, address(0), 0);
        vm.expectRevert(_wrongAmount(3 ether + FEE, 3 ether + FEE + 1));
        swap.createTrade{value: 3 ether + FEE + 1}(offered, requested, address(0), 0);
        vm.stopPrank();

        uint256 id = _create(alice, offered, requested);
        assertEq(address(swap).balance, 3 ether + FEE);
        assertEq(alice.balance, START_MON - 3 ether - FEE);
        assertEq(uint8(_status(id)), uint8(IOnDealV2.Status.Open));
    }

    function test_createTradeWithNoNativeStillNeedsTheFee() public {
        IOnDealV2.Asset[] memory offered = _list(_chog(A1));
        IOnDealV2.Asset[] memory requested = _list(_chog(B1));

        vm.prank(alice);
        vm.expectRevert(_wrongAmount(FEE, 0));
        swap.createTrade(offered, requested, address(0), 0);

        _create(alice, offered, requested);
        assertEq(address(swap).balance, FEE);
    }

    function test_createTraitTradeNeedsTheFee() public {
        IOnDealV2.Asset[] memory requested = _list(_traitAsset(B1));
        vm.prank(alice);
        vm.expectRevert(_wrongAmount(FEE, 0));
        swap.createTraitTrade(_list(_chog(A1)), requested, address(0), 0, "spec");

        vm.prank(alice);
        swap.createTraitTrade{value: FEE}(_list(_chog(A1)), requested, address(0), 0, "spec");
        assertEq(address(swap).balance, FEE);
    }

    function test_createOpenOfferNeedsTheFee() public {
        IOnDealV2.Asset[] memory offered = _list(_chog(A1), _native(1 ether));
        vm.prank(alice);
        vm.expectRevert(_wrongAmount(1 ether + FEE, 1 ether));
        swap.createOpenOffer{value: 1 ether}(offered, address(0), 0, "");

        _openOffer(alice, offered, "");
        assertEq(address(swap).balance, 1 ether + FEE);
    }

    function test_proposeNeedsTheNativeAmountPlusFee() public {
        uint256 id = _openOffer(alice, _list(_chog(A1)), "");
        IOnDealV2.Asset[] memory assets = _list(_chog(B1), _native(1 ether));

        vm.prank(bob);
        vm.expectRevert(_wrongAmount(1 ether + FEE, 1 ether));
        swap.propose{value: 1 ether}(id, assets);

        _propose(bob, id, assets);
        assertEq(address(swap).balance, FEE + 1 ether + FEE); // alice's share, bob's share + MON
    }

    function test_fillTradeNeedsTheNativeAmountPlusFee() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_native(3 ether)));

        vm.startPrank(bob);
        vm.expectRevert(_wrongAmount(3 ether + FEE, 3 ether));
        swap.fillTrade{value: 3 ether}(id);
        vm.expectRevert(_wrongAmount(3 ether + FEE, 3 ether + FEE + 1));
        swap.fillTrade{value: 3 ether + FEE + 1}(id);
        vm.stopPrank();
        assertEq(uint8(_status(id)), uint8(IOnDealV2.Status.Open));
    }

    function test_fillTradeForNftsStillNeedsTheFee() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        vm.prank(bob);
        vm.expectRevert(_wrongAmount(FEE, 0));
        swap.fillTrade(id);
    }

    function test_fillTraitTradeNeedsTheFee() public {
        vm.prank(alice);
        uint256 id = swap.createTraitTrade{value: FEE}(
            _list(_chog(A1)), _list(_traitAsset(B1)), address(0), 0, "spec"
        );
        IOnDealV2.TraitFill[] memory fills = _fillFor(B1);

        vm.prank(bob);
        vm.expectRevert(_wrongAmount(FEE, 0));
        swap.fillTraitTrade(id, fills);

        vm.prank(bob);
        swap.fillTraitTrade{value: FEE}(id, fills);
        _assertOwner(A1, bob);
        _assertOwner(B1, alice);
        assertEq(treasury.balance, 2 * FEE);
        assertEq(address(swap).balance, 0);
    }

    // ───────────────────────────────────────────── completion releases both shares

    function test_fillPaysBothSharesToTheRecipientAndNothingStaysBehind() public {
        uint256 id = _create(
            alice, _list(_chog(A1), _erc20(address(weth), 1 ether)), _list(_native(3 ether))
        );

        vm.expectEmit(true, true, false, true, address(swap));
        emit IOnDealV2.FeeCharged(id, treasury, 2 * FEE);
        _fill(bob, id);

        assertEq(treasury.balance, 2 * FEE);
        assertEq(alice.balance, START_MON - FEE + 3 ether);
        assertEq(bob.balance, START_MON - 3 ether - FEE);
        assertEq(weth.balanceOf(bob), START_TOKEN + 1 ether);
        _assertOwner(A1, bob);
        assertEq(address(swap).balance, 0);
    }

    function test_fillOfAnNftSwapPaysTheFeeToo() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        _fill(bob, id);
        assertEq(treasury.balance, 2 * FEE);
        assertEq(alice.balance, START_MON - FEE);
        assertEq(bob.balance, START_MON - FEE);
        assertEq(address(swap).balance, 0);
    }

    function test_acceptingAProposalPaysBothSharesAndIsNotPayable() public {
        uint256 id = _openOffer(alice, _list(_chog(A1)), "");
        uint256 pid = _propose(bob, id, _list(_chog(B1), _native(1 ether)));
        assertEq(address(swap).balance, 2 * FEE + 1 ether);

        vm.expectEmit(true, true, false, true, address(swap));
        emit IOnDealV2.FeeCharged(id, treasury, 2 * FEE);
        vm.prank(alice);
        swap.acceptProposal(id, pid);

        assertEq(treasury.balance, 2 * FEE);
        assertEq(alice.balance, START_MON - FEE + 1 ether);
        assertEq(bob.balance, START_MON - FEE - 1 ether);
        assertEq(address(swap).balance, 0);

        // The proposer's share was already in escrow, so there is nothing to send.
        uint256 other = _openOffer(alice, _list(_chog(2)), "");
        uint256 pid2 = _propose(bob, other, _list(_chog(7)));
        vm.prank(alice);
        (bool ok,) =
            address(swap).call{value: 1}(abi.encodeCall(IOnDealV2.acceptProposal, (other, pid2)));
        assertFalse(ok);
    }

    function test_otherProposalsKeepTheirShareUntilWithdrawn() public {
        uint256 id = _openOffer(alice, _list(_chog(A1)), "");
        uint256 first = _propose(bob, id, _list(_chog(B1)));
        uint256 second = _propose(carol, id, _list(_chog(C1)));
        vm.prank(alice);
        swap.acceptProposal(id, first);

        // alice + bob paid out. carol's share is still held with her proposal.
        assertEq(treasury.balance, 2 * FEE);
        assertEq(address(swap).balance, FEE);

        vm.prank(carol);
        swap.withdrawProposal(id, second);
        assertEq(carol.balance, START_MON);
        assertEq(address(swap).balance, 0);
        assertEq(treasury.balance, 2 * FEE);
    }

    // ───────────────────────────────────────────── no deal, no fee

    function test_cancelRefundsTheMakersShare() public {
        uint256 id = _create(alice, _list(_chog(A1), _native(1 ether)), _list(_chog(B1)));
        assertEq(address(swap).balance, 1 ether + FEE);

        vm.prank(alice);
        swap.cancelTrade(id);

        assertEq(alice.balance, START_MON);
        assertEq(treasury.balance, 0);
        assertEq(address(swap).balance, 0);
    }

    function test_reclaimRefundsTheMakerNotTheCaller() public {
        uint256 id = _create(
            alice, _list(_chog(A1)), _list(_chog(B1)), address(0), uint64(block.timestamp + 1 days)
        );
        vm.warp(block.timestamp + 2 days);

        vm.prank(carol);
        swap.reclaimExpired(id);

        assertEq(alice.balance, START_MON);
        assertEq(carol.balance, START_MON);
        assertEq(treasury.balance, 0);
        assertEq(address(swap).balance, 0);
    }

    function test_rejectRefundsTheProposersShareAndKeepsTheMakers() public {
        uint256 id = _openOffer(alice, _list(_chog(A1)), "");
        uint256 pid = _propose(bob, id, _list(_chog(B1), _native(1 ether)));

        vm.prank(alice);
        swap.rejectProposal(id, pid);

        assertEq(bob.balance, START_MON);
        assertEq(treasury.balance, 0);
        assertEq(address(swap).balance, FEE); // alice's share, until her offer ends
    }

    function test_withdrawRefundsTheProposersShare() public {
        uint256 id = _openOffer(alice, _list(_chog(A1)), "");
        uint256 pid = _propose(bob, id, _list(_chog(B1)));

        vm.prank(bob);
        swap.withdrawProposal(id, pid);

        assertEq(bob.balance, START_MON);
        assertEq(treasury.balance, 0);
        assertEq(address(swap).balance, FEE);
    }

    function test_withdrawStillRefundsAfterTheOfferWasCancelled() public {
        uint256 id = _openOffer(alice, _list(_chog(A1)), "");
        uint256 pid = _propose(bob, id, _list(_chog(B1)));
        vm.prank(alice);
        swap.cancelTrade(id);
        assertEq(address(swap).balance, FEE); // only bob's proposal is left

        vm.prank(bob);
        swap.withdrawProposal(id, pid);
        assertEq(bob.balance, START_MON);
        assertEq(alice.balance, START_MON);
        assertEq(treasury.balance, 0);
        assertEq(address(swap).balance, 0);
    }

    function test_aRevertedFillChargesNothing() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        vm.prank(bob);
        chog.setApprovalForAll(address(swap), false); // the taker's NFT can't move
        vm.prank(bob);
        vm.expectRevert();
        swap.fillTrade{value: FEE}(id);

        assertEq(bob.balance, START_MON);
        assertEq(treasury.balance, 0);
        assertEq(address(swap).balance, FEE);
    }

    // ───────────────────────────────────────────── a recipient that rejects MON

    function test_recipientThatRejectsMonIsCreditedAndTheFillStillWorks() public {
        MonReceiver picky = new MonReceiver();
        OnDealV2 s = new OnDealV2(FEE, address(picky));
        vm.prank(alice);
        chog.setApprovalForAll(address(s), true);
        vm.prank(bob);
        chog.setApprovalForAll(address(s), true);

        vm.prank(alice);
        uint256 id = s.createTrade{value: FEE}(_list(_chog(A1)), _list(_chog(B1)), address(0), 0);
        vm.expectEmit(true, true, false, true, address(s));
        emit IOnDealV2.AssetCredited(address(picky), address(0), NATIVE, 0, 2 * FEE);
        vm.prank(bob);
        s.fillTrade{value: FEE}(id);

        assertEq(uint8(s.getTrade(id).status), uint8(IOnDealV2.Status.Filled));
        assertEq(chog.ownerOf(A1), bob);
        assertEq(s.claimable(address(picky), NATIVE, address(0), 0), 2 * FEE);
        assertEq(address(s).balance, 2 * FEE);

        picky.setAccept(true);
        vm.prank(address(picky));
        s.claim(NATIVE, address(0), 0);
        assertEq(address(picky).balance, 2 * FEE);
        assertEq(address(s).balance, 0);
    }

    function test_makerThatRejectsMonGetsTheRefundCreditedWithItsEscrow() public {
        MonReceiver picky = new MonReceiver();
        chog.mint(address(picky), 1); // 16
        vm.deal(address(picky), 10 ether);
        vm.startPrank(address(picky));
        chog.setApprovalForAll(address(swap), true);
        uint256 id = swap.createTrade{value: 1 ether + FEE}(
            _list(_chog(16), _native(1 ether)), _list(_chog(B1)), address(0), 0
        );
        swap.cancelTrade(id);
        vm.stopPrank();

        _assertOwner(16, address(picky));
        // The native asset and the fee share add up to one credit.
        assertEq(swap.claimable(address(picky), NATIVE, address(0), 0), 1 ether + FEE);
        assertEq(address(swap).balance, 1 ether + FEE);
    }

    function test_recipientCannotReenterWhileBeingPaid() public {
        ReentrantReceiver reentrant = new ReentrantReceiver();
        OnDealV2 s = new OnDealV2(FEE, address(reentrant));
        vm.prank(alice);
        chog.setApprovalForAll(address(s), true);
        vm.prank(bob);
        chog.setApprovalForAll(address(s), true);

        vm.prank(alice);
        uint256 id = s.createTrade{value: FEE}(_list(_chog(A1)), _list(_chog(B1)), address(0), 0);
        reentrant.arm(address(s), abi.encodeCall(IOnDealV2.cancelTrade, (id)));
        vm.prank(bob);
        s.fillTrade{value: FEE}(id);

        assertTrue(reentrant.attempted());
        assertFalse(reentrant.reentrySucceeded());
        assertEq(
            bytes4(reentrant.reentryRevertData()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
        assertEq(address(reentrant).balance, 2 * FEE);
        assertEq(address(s).balance, 0);
    }

    // ───────────────────────────────────────────── zero fee

    function test_aZeroFeeDeploymentChargesAndEmitsNothing() public {
        OnDealV2 free = new OnDealV2(0, address(0));
        vm.prank(alice);
        chog.setApprovalForAll(address(free), true);
        vm.prank(bob);
        chog.setApprovalForAll(address(free), true);

        vm.prank(alice);
        uint256 id = free.createTrade(_list(_chog(A1)), _list(_chog(B1)), address(0), 0);
        vm.recordLogs();
        vm.prank(bob);
        free.fillTrade(id);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != IOnDealV2.FeeCharged.selector, "FeeCharged emitted");
        }
        assertEq(address(free).balance, 0);
    }

    // ───────────────────────────────────────────── fuzz

    /// A fill moves exactly the listed MON plus one share from each side, and the escrow ends
    /// empty.
    function testFuzz_fillConservesMon(uint96 offeredMon, uint96 requestedMon) public {
        offeredMon = uint96(bound(offeredMon, 1, 50 ether));
        requestedMon = uint96(bound(requestedMon, 1, 50 ether));
        uint256 id =
            _create(alice, _list(_native(offeredMon)), _list(_erc20(address(usdc), 5 ether)));

        vm.prank(bob);
        swap.fillTrade{value: FEE}(id);

        assertEq(alice.balance, START_MON - offeredMon - FEE);
        assertEq(bob.balance, START_MON + offeredMon - FEE);
        assertEq(treasury.balance, 2 * FEE);
        assertEq(address(swap).balance, 0);

        // And the same shape asked for MON.
        uint256 id2 = _create(alice, _list(_chog(A1)), _list(_native(requestedMon)));
        _fill(bob, id2);
        assertEq(treasury.balance, 4 * FEE);
        assertEq(address(swap).balance, 0);
    }
}
