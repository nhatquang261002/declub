// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDeClubEscrow} from "../../src/interfaces/IDeClubEscrow.sol";
import {DeClubEscrowBase} from "./DeClubEscrowBase.sol";
import {MonReceiver} from "../utils/Actors.sol";
import {BlocklistToken, FeeToken, HookToken} from "../utils/WeirdTokens.sol";

/// @dev Open offers (docs/adr/0007-open-offers.md): creation with a note, escrowed proposals,
///      accept / reject / withdraw, and the guard that keeps `fillTrade` away from them.
contract DeClubEscrowOffersTest is DeClubEscrowBase {
    IDeClubEscrow.ProposalStatus internal constant ACTIVE = IDeClubEscrow.ProposalStatus.Active;
    IDeClubEscrow.ProposalStatus internal constant ACCEPTED = IDeClubEscrow.ProposalStatus.Accepted;
    IDeClubEscrow.ProposalStatus internal constant WITHDRAWN =
    IDeClubEscrow.ProposalStatus.Withdrawn;
    IDeClubEscrow.ProposalStatus internal constant REJECTED = IDeClubEscrow.ProposalStatus.Rejected;

    /// @dev alice offers Chog A1 + 20 WETH, no ask.
    function _offer() internal returns (uint256) {
        return _openOffer(
            alice, _list(_chog(A1), _erc20(address(weth), 20 ether)), "any Chog with a crown"
        );
    }

    function _proposalStatus(uint256 id, uint256 pid)
        internal
        view
        returns (IDeClubEscrow.ProposalStatus)
    {
        return swap.getProposal(id, pid).status;
    }

    // ───────────────────────────────────────────── creation

    function test_createOpenOfferEscrowsAndStoresNote() public {
        vm.expectEmit(true, true, true, true, address(swap));
        emit IDeClubEscrow.TradeCreated(
            1,
            alice,
            address(0),
            _list(_chog(A1), _erc20(address(weth), 20 ether)),
            new IDeClubEscrow.Asset[](0),
            0
        );
        vm.expectEmit(true, false, false, true, address(swap));
        emit IDeClubEscrow.OfferNote(1, "any Chog with a crown");
        uint256 id = _offer();

        IDeClubEscrow.Trade memory t = swap.getTrade(id);
        assertEq(t.maker, alice);
        assertEq(uint8(t.status), uint8(IDeClubEscrow.Status.Open));
        assertEq(t.offered.length, 2);
        assertEq(t.requested.length, 0);
        assertEq(swap.offerNote(id), "any Chog with a crown");
        _assertOwner(A1, address(swap));
        assertEq(weth.balanceOf(address(swap)), 20 ether);
        assertEq(swap.proposalCount(id), 0);
    }

    function test_emptyNoteIsAllowedAndEmitsNoEvent() public {
        vm.recordLogs();
        uint256 id = _openOffer(alice, _list(_chog(A1)), "");
        assertEq(swap.offerNote(id), "");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != IDeClubEscrow.OfferNote.selector);
        }
    }

    function test_noteAtTheLimitPassesAndOneOverReverts() public {
        bytes memory ok = new bytes(280);
        for (uint256 i; i < 280; ++i) {
            ok[i] = "a";
        }
        uint256 id = _openOffer(alice, _list(_chog(A1)), string(ok));
        assertEq(bytes(swap.offerNote(id)).length, 280);

        bytes memory tooLong = new bytes(281);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.NoteTooLong.selector, 281, 280));
        swap.createOpenOffer(_list(_chog(A2)), address(0), 0, string(tooLong));
    }

    function test_createOpenOfferValidatesTheOfferedSide() public {
        vm.startPrank(alice);
        vm.expectRevert(IDeClubEscrow.EmptySide.selector);
        swap.createOpenOffer(new IDeClubEscrow.Asset[](0), address(0), 0, "");

        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.DuplicateAsset.selector, 1));
        swap.createOpenOffer(_list(_chog(A1), _chog(A1)), address(0), 0, "");

        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.WrongNativeAmount.selector, 1 ether, 0)
        );
        swap.createOpenOffer(_list(_native(1 ether)), address(0), 0, "");

        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.ExpiryInPast.selector, block.timestamp)
        );
        swap.createOpenOffer(_list(_chog(A1)), address(0), uint64(block.timestamp), "");
        vm.stopPrank();
    }

    function test_createTradeStillRejectsAnEmptyAsk() public {
        vm.prank(alice);
        vm.expectRevert(IDeClubEscrow.EmptySide.selector);
        swap.createTrade(_list(_chog(A1)), new IDeClubEscrow.Asset[](0), address(0), 0);
    }

    function test_fixedTradeHasNoNote() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        assertEq(swap.offerNote(id), "");
    }

    // ───────────────────────────────────────────── fillTrade guard

    function test_fillTradeCannotTakeAnOpenOffer() public {
        uint256 id = _offer();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.OpenOfferNoFill.selector, id));
        swap.fillTrade(id);

        _assertOwner(A1, address(swap));
        assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Open));
    }

    // ───────────────────────────────────────────── propose

    function test_proposeEscrowsTheAssets() public {
        uint256 id = _offer();
        IDeClubEscrow.Asset[] memory assets =
            _list(_chog(B1), _erc20(address(usdc), 40 ether), _native(2 ether));

        vm.expectEmit(true, true, true, true, address(swap));
        emit IDeClubEscrow.ProposalCreated(id, 0, bob, assets);
        uint256 pid = _propose(bob, id, assets);

        assertEq(pid, 0);
        assertEq(swap.proposalCount(id), 1);
        IDeClubEscrow.Proposal memory p = swap.getProposal(id, pid);
        assertEq(p.proposer, bob);
        assertEq(uint8(p.status), uint8(ACTIVE));
        assertEq(p.assets.length, 3);
        _assertOwner(B1, address(swap));
        assertEq(usdc.balanceOf(address(swap)), 40 ether);
        assertEq(address(swap).balance, 2 ether);
        assertEq(weth.balanceOf(address(swap)), 20 ether);
        assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Open));
    }

    function test_severalProposersGetSequentialIds() public {
        uint256 id = _offer();
        assertEq(_propose(bob, id, _list(_chog(B1))), 0);
        assertEq(_propose(carol, id, _list(_chog(C1))), 1);
        assertEq(_propose(bob, id, _list(_chog(B2))), 2);
        assertEq(swap.proposalCount(id), 3);
    }

    function test_proposeRevertsOnAFixedTrade() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.NotOpenOffer.selector, id));
        swap.propose(id, _list(_chog(B2)));
    }

    function test_proposeRevertsWhenTradeIsNotOpen() public {
        uint256 id = _offer();
        vm.prank(alice);
        swap.cancelTrade(id);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TradeNotOpen.selector, id));
        swap.propose(id, _list(_chog(B1)));

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TradeNotOpen.selector, 99));
        swap.propose(99, _list(_chog(B1)));
    }

    function test_proposeRevertsAfterExpiry() public {
        uint256 id =
            _openOffer(alice, _list(_chog(A1)), "", address(0), uint64(block.timestamp + 1 hours));
        _propose(bob, id, _list(_chog(B1))); // still fine
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TradeIsExpired.selector, id));
        swap.propose(id, _list(_chog(C1)));
    }

    function test_proposeRespectsTheTakerRestriction() public {
        uint256 id = _openOffer(alice, _list(_chog(A1)), "", bob, 0);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.NotAllowedTaker.selector, id));
        swap.propose(id, _list(_chog(C1)));
        _propose(bob, id, _list(_chog(B1)));
    }

    function test_makerCannotProposeOnTheirOwnOffer() public {
        uint256 id = _offer();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.SelfPropose.selector, id));
        swap.propose(id, _list(_chog(A2)));
    }

    function test_proposeValidatesTheAssets() public {
        uint256 id = _offer();
        vm.startPrank(bob);
        vm.expectRevert(IDeClubEscrow.EmptySide.selector);
        swap.propose(id, new IDeClubEscrow.Asset[](0));

        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.DuplicateAsset.selector, 1));
        swap.propose(id, _list(_chog(B1), _chog(B1)));

        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.InvalidAsset.selector, 0));
        swap.propose(id, _list(_erc20(address(usdc), 0)));

        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.SameAssetBothSides.selector, 1, 0));
        swap.propose(id, _list(_erc20(address(weth), 1 ether)));

        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.WrongNativeAmount.selector, 1 ether, 0)
        );
        swap.propose(id, _list(_native(1 ether)));
        vm.stopPrank();
    }

    function test_proposalCannotContainAnAssetTheMakerOffers() public {
        uint256 id = _openOffer(alice, _list(_erc20(address(usdc), 10 ether)), "");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.SameAssetBothSides.selector, 0, 1));
        swap.propose(id, _list(_chog(B1), _erc20(address(usdc), 5 ether)));
    }

    function test_proposeRevertsWithoutApprovalOrOwnership() public {
        uint256 id = _offer();
        vm.startPrank(bob);
        vm.expectRevert(); // Chog A2 belongs to alice
        swap.propose(id, _list(_chog(A2)));
        vm.stopPrank();

        address dave = makeAddr("dave");
        chog.mint(dave, 1); // 16, no approval given
        vm.prank(dave);
        vm.expectRevert();
        swap.propose(id, _list(_chog(16)));
        assertEq(swap.proposalCount(id), 0);
    }

    function test_feeOnTransferTokenCannotBeProposed() public {
        FeeToken fee = new FeeToken();
        fee.mint(bob, 1_000 ether);
        vm.prank(bob);
        fee.approve(address(swap), type(uint256).max);
        uint256 id = _offer();

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IDeClubEscrow.UnsupportedToken.selector, address(fee))
        );
        swap.propose(id, _list(_erc20(address(fee), 100 ether)));
        assertEq(fee.balanceOf(bob), 1_000 ether);
        assertEq(swap.proposalCount(id), 0);
    }

    // ───────────────────────────────────────────── accept

    function test_acceptSettlesBothSides() public {
        uint256 id = _offer();
        uint256 pid =
            _propose(bob, id, _list(_chog(B1), _erc20(address(usdc), 40 ether), _native(2 ether)));

        uint256 aliceMon = alice.balance;
        vm.expectEmit(true, true, true, true, address(swap));
        emit IDeClubEscrow.TradeFilled(id, alice, bob);
        vm.expectEmit(true, true, false, true, address(swap));
        emit IDeClubEscrow.ProposalAccepted(id, pid);
        vm.prank(alice);
        swap.acceptProposal(id, pid);

        _assertOwner(A1, bob);
        _assertOwner(B1, alice);
        assertEq(usdc.balanceOf(alice), START_TOKEN + 40 ether);
        assertEq(usdc.balanceOf(bob), START_TOKEN - 40 ether);
        assertEq(alice.balance, aliceMon + 2 ether);
        assertEq(bob.balance, START_MON - 2 ether);
        assertEq(weth.balanceOf(bob), START_TOKEN + 20 ether);
        assertEq(address(swap).balance, 0);
        assertEq(usdc.balanceOf(address(swap)), 0);
        assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Filled));
        assertEq(uint8(_proposalStatus(id, pid)), uint8(ACCEPTED));
    }

    function test_acceptLeavesOtherProposalsWithdrawable() public {
        uint256 id = _offer();
        uint256 p0 = _propose(bob, id, _list(_chog(B1)));
        uint256 p1 = _propose(carol, id, _list(_chog(C1), _native(1 ether)));

        vm.prank(alice);
        swap.acceptProposal(id, p1);

        assertEq(uint8(_proposalStatus(id, p0)), uint8(ACTIVE));
        _assertOwner(B1, address(swap)); // still escrowed until bob pulls it
        vm.prank(bob);
        swap.withdrawProposal(id, p0);
        _assertOwner(B1, bob);
        _assertOwner(C1, alice);
        _assertOwner(A1, carol);
    }

    function test_acceptIsMakerOnly() public {
        uint256 id = _offer();
        uint256 pid = _propose(bob, id, _list(_chog(B1)));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.NotMaker.selector, id));
        swap.acceptProposal(id, pid);
    }

    function test_acceptRevertsAfterExpiry() public {
        uint256 id =
            _openOffer(alice, _list(_chog(A1)), "", address(0), uint64(block.timestamp + 1 hours));
        uint256 pid = _propose(bob, id, _list(_chog(B1)));
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TradeIsExpired.selector, id));
        swap.acceptProposal(id, pid);
    }

    function test_acceptRevertsForUnknownOrInactiveProposals() public {
        uint256 id = _offer();
        uint256 pid = _propose(bob, id, _list(_chog(B1)));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.UnknownProposal.selector, id, 7));
        swap.acceptProposal(id, 7);

        vm.prank(bob);
        swap.withdrawProposal(id, pid);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.ProposalNotActive.selector, id, pid));
        swap.acceptProposal(id, pid);
    }

    function test_acceptTwiceReverts() public {
        uint256 id = _offer();
        uint256 pid = _propose(bob, id, _list(_chog(B1)));
        vm.startPrank(alice);
        swap.acceptProposal(id, pid);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TradeNotOpen.selector, id));
        swap.acceptProposal(id, pid);
        vm.stopPrank();
    }

    function test_acceptOnAFixedTradeRevertsWithUnknownProposal() public {
        uint256 id = _create(alice, _list(_chog(A1)), _list(_chog(B1)));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.UnknownProposal.selector, id, 0));
        swap.acceptProposal(id, 0);
    }

    function test_makerThatRejectsMonIsCreditedOnAccept() public {
        MonReceiver picky = new MonReceiver();
        vm.deal(address(picky), 10 ether);
        chog.mint(address(picky), 1); // 16
        vm.prank(address(picky));
        chog.setApprovalForAll(address(swap), true);

        vm.prank(address(picky));
        uint256 id = swap.createOpenOffer(_list(_chog(16)), address(0), 0, "");
        uint256 pid = _propose(bob, id, _list(_native(3 ether)));

        vm.prank(address(picky));
        swap.acceptProposal(id, pid);

        _assertOwner(16, bob);
        assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Filled));
        assertEq(
            swap.claimable(address(picky), IDeClubEscrow.AssetType.Native, address(0), 0), 3 ether
        );
    }

    function test_proposerThatIsBlocklistedCannotBlockAccept() public {
        BlocklistToken blk = new BlocklistToken();
        blk.mint(alice, 100 ether);
        vm.prank(alice);
        blk.approve(address(swap), type(uint256).max);
        uint256 id = _openOffer(alice, _list(_erc20(address(blk), 50 ether)), "");
        uint256 pid = _propose(bob, id, _list(_chog(B1)));

        blk.setBlocked(bob, true);
        vm.prank(alice);
        swap.acceptProposal(id, pid);

        _assertOwner(B1, alice);
        assertEq(swap.claimable(bob, IDeClubEscrow.AssetType.ERC20, address(blk), 0), 50 ether);
    }

    // ───────────────────────────────────────────── withdraw

    function test_proposerWithdrawsAtAnyTimeWhileOpen() public {
        uint256 id = _offer();
        uint256 pid = _propose(bob, id, _list(_chog(B1), _native(2 ether)));

        uint256 bobMon = bob.balance;
        vm.expectEmit(true, true, false, true, address(swap));
        emit IDeClubEscrow.ProposalWithdrawn(id, pid);
        vm.prank(bob);
        swap.withdrawProposal(id, pid);

        _assertOwner(B1, bob);
        assertEq(bob.balance, bobMon + 2 ether);
        assertEq(uint8(_proposalStatus(id, pid)), uint8(WITHDRAWN));
        assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Open));
    }

    function test_withdrawWorksAfterCancelAndAfterExpiry() public {
        uint256 id = _offer();
        uint256 p0 = _propose(bob, id, _list(_chog(B1)));
        vm.prank(alice);
        swap.cancelTrade(id);
        _assertOwner(A1, alice); // the maker's side came back
        _assertOwner(B1, address(swap)); // the proposal is untouched
        vm.prank(bob);
        swap.withdrawProposal(id, p0);
        _assertOwner(B1, bob);

        uint256 id2 =
            _openOffer(alice, _list(_chog(A2)), "", address(0), uint64(block.timestamp + 1 hours));
        uint256 p1 = _propose(carol, id2, _list(_chog(C1)));
        vm.warp(block.timestamp + 2 hours);
        swap.reclaimExpired(id2);
        vm.prank(carol);
        swap.withdrawProposal(id2, p1);
        _assertOwner(C1, carol);
    }

    function test_withdrawIsProposerOnlyAndOnlyOnce() public {
        uint256 id = _offer();
        uint256 pid = _propose(bob, id, _list(_chog(B1)));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.NotProposer.selector, id, pid));
        swap.withdrawProposal(id, pid);

        vm.startPrank(bob);
        swap.withdrawProposal(id, pid);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.ProposalNotActive.selector, id, pid));
        swap.withdrawProposal(id, pid);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.UnknownProposal.selector, id, 5));
        swap.withdrawProposal(id, 5);
        vm.stopPrank();
    }

    function test_withdrawAfterAcceptRevertsForTheAcceptedProposal() public {
        uint256 id = _offer();
        uint256 pid = _propose(bob, id, _list(_chog(B1)));
        vm.prank(alice);
        swap.acceptProposal(id, pid);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.ProposalNotActive.selector, id, pid));
        swap.withdrawProposal(id, pid);
    }

    // ───────────────────────────────────────────── reject

    function test_makerRejectsAndProposerIsRefunded() public {
        uint256 id = _offer();
        uint256 pid = _propose(bob, id, _list(_chog(B1), _erc20(address(usdc), 10 ether)));

        vm.expectEmit(true, true, false, true, address(swap));
        emit IDeClubEscrow.ProposalRejected(id, pid);
        vm.prank(alice);
        swap.rejectProposal(id, pid);

        _assertOwner(B1, bob);
        assertEq(usdc.balanceOf(bob), START_TOKEN);
        assertEq(uint8(_proposalStatus(id, pid)), uint8(REJECTED));
        assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Open));
    }

    function test_rejectRules() public {
        uint256 id = _offer();
        uint256 pid = _propose(bob, id, _list(_chog(B1)));

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.NotMaker.selector, id));
        swap.rejectProposal(id, pid);

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.UnknownProposal.selector, id, 3));
        swap.rejectProposal(id, 3);
        swap.rejectProposal(id, pid);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.ProposalNotActive.selector, id, pid));
        swap.rejectProposal(id, pid);

        uint256 p2 = _proposeAs(bob, id, _list(_chog(B2)));
        swap.cancelTrade(id);
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.TradeNotOpen.selector, id));
        swap.rejectProposal(id, p2);
        vm.stopPrank();
    }

    /// @dev `_propose` from inside another prank.
    function _proposeAs(address who, uint256 id, IDeClubEscrow.Asset[] memory assets)
        internal
        returns (uint256 pid)
    {
        vm.stopPrank();
        pid = _propose(who, id, assets);
        vm.startPrank(alice);
    }

    function test_proposerCanProposeAgainAfterRejection() public {
        uint256 id = _offer();
        uint256 p0 = _propose(bob, id, _list(_chog(B1)));
        vm.prank(alice);
        swap.rejectProposal(id, p0);
        uint256 p1 = _propose(bob, id, _list(_chog(B1), _native(1 ether)));
        assertEq(p1, 1);
        assertEq(uint8(_proposalStatus(id, p1)), uint8(ACTIVE));
    }

    // ───────────────────────────────────────────── cancel and reclaim leave proposals alone

    function test_cancelReturnsOnlyTheMakersAssets() public {
        uint256 id = _offer();
        _propose(bob, id, _list(_chog(B1), _native(1 ether)));

        vm.prank(alice);
        swap.cancelTrade(id);

        _assertOwner(A1, alice);
        _assertOwner(B1, address(swap));
        assertEq(weth.balanceOf(alice), START_TOKEN); // the WETH came back too
        assertEq(address(swap).balance, 1 ether); // only bob's proposal remains
    }

    // ───────────────────────────────────────────── views

    function test_getProposalsPaginates() public {
        uint256 id = _offer();
        for (uint256 i; i < 5; ++i) {
            _propose(i % 2 == 0 ? bob : carol, id, _list(_erc20(address(usdc), (i + 1) * 1 ether)));
        }

        IDeClubEscrow.Proposal[] memory page = swap.getProposals(id, 1, 2);
        assertEq(page.length, 2);
        assertEq(page[0].assets[0].amount, 2 ether);
        assertEq(page[1].assets[0].amount, 3 ether);

        assertEq(swap.getProposals(id, 3, 10).length, 2); // clamped
        assertEq(swap.getProposals(id, 5, 10).length, 0); // offset at the end
        assertEq(swap.getProposals(id, 99, 10).length, 0);
        assertEq(swap.getProposals(id, 0, 0).length, 0);
        assertEq(swap.getProposals(999, 0, 10).length, 0); // unknown trade
    }

    function test_getProposalRevertsOutOfRange() public {
        uint256 id = _offer();
        vm.expectRevert(abi.encodeWithSelector(IDeClubEscrow.UnknownProposal.selector, id, 0));
        swap.getProposal(id, 0);
    }

    function test_constants() public view {
        assertEq(swap.MAX_NOTE_BYTES(), 280);
    }

    // ───────────────────────────────────────────── re-entry

    function test_tokenHookCannotReenterDuringPropose() public {
        HookToken hook = new HookToken();
        hook.mint(bob, 1_000 ether);
        vm.prank(bob);
        hook.approve(address(swap), type(uint256).max);

        uint256 id = _offer();
        uint256 other = _propose(carol, id, _list(_chog(C1)));
        // While bob's tokens move in, the hook tries to accept carol's proposal as ... itself.
        hook.arm(address(swap), abi.encodeCall(IDeClubEscrow.acceptProposal, (id, other)));
        _propose(bob, id, _list(_erc20(address(hook), 10 ether)));

        assertTrue(hook.attempted());
        assertFalse(hook.reentrySucceeded());
        assertEq(
            bytes4(hook.reentryRevertData()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
        assertEq(uint8(_status(id)), uint8(IDeClubEscrow.Status.Open));
    }

    function test_tokenHookCannotReenterDuringAccept() public {
        HookToken hook = new HookToken();
        hook.mint(bob, 1_000 ether);
        vm.prank(bob);
        hook.approve(address(swap), type(uint256).max);

        uint256 id = _offer();
        uint256 pid = _propose(bob, id, _list(_erc20(address(hook), 10 ether)));
        // The hook fires when the proposal's tokens are paid out to alice, and tries to withdraw.
        hook.arm(address(swap), abi.encodeCall(IDeClubEscrow.withdrawProposal, (id, pid)));
        vm.prank(alice);
        swap.acceptProposal(id, pid);

        assertTrue(hook.attempted());
        assertFalse(hook.reentrySucceeded());
        assertEq(uint8(_proposalStatus(id, pid)), uint8(ACCEPTED));
        assertEq(hook.balanceOf(alice), 10 ether);
    }
}
