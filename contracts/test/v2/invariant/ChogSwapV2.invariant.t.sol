// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogSwapV2} from "../../../src/ChogSwapV2.sol";
import {IChogSwapV2} from "../../../src/interfaces/IChogSwapV2.sol";
import {MockChog} from "../../../src/mocks/MockChog.sol";
import {MockERC20} from "../../../src/mocks/MockERC20.sol";
import {BlocklistToken} from "../../utils/WeirdTokens.sol";
import {Handler} from "./Handler.sol";

/// @dev The escrow is always exactly what open trades and `Active` proposals hold plus what is
///      credited for `claim`, for native, every ERC-20 and every NFT, however the calls
///      interleave.
contract ChogSwapV2InvariantTest is Test {
    ChogSwapV2 internal swap;
    MockChog internal chog;
    MockERC20 internal usdc;
    BlocklistToken internal blk;
    Handler internal handler;

    function setUp() public {
        swap = new ChogSwapV2();
        chog = new MockChog();
        usdc = new MockERC20("USD Coin", "USDC");
        blk = new BlocklistToken();
        handler = new Handler(swap, chog, usdc, blk);

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](13);
        selectors[0] = Handler.create.selector;
        selectors[1] = Handler.fill.selector;
        selectors[2] = Handler.cancel.selector;
        selectors[3] = Handler.reclaim.selector;
        selectors[4] = Handler.claim.selector;
        selectors[5] = Handler.setBlocked.selector;
        selectors[6] = Handler.acceptMon.selector;
        selectors[7] = Handler.warp.selector;
        selectors[8] = Handler.createOffer.selector;
        selectors[9] = Handler.propose.selector;
        selectors[10] = Handler.acceptProposal.selector;
        selectors[11] = Handler.rejectProposal.selector;
        selectors[12] = Handler.withdrawProposal.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function _credits(IChogSwapV2.AssetType t, address token, uint256 id)
        internal
        view
        returns (uint256 sum)
    {
        for (uint256 i; i < handler.actorCount(); ++i) {
            sum += swap.claimable(handler.actors(i), t, token, id);
        }
    }

    function _sumOf(IChogSwapV2.Asset[] memory assets, IChogSwapV2.AssetType t, address token)
        internal
        pure
        returns (uint256 sum)
    {
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i].assetType == t && assets[i].token == token) sum += assets[i].amount;
        }
    }

    /// @dev What escrow holds of a fungible: open trades' offered sides plus `Active` proposals.
    function _openOffered(IChogSwapV2.AssetType t, address token)
        internal
        view
        returns (uint256 sum)
    {
        for (uint256 id = 1; id <= swap.tradeCount(); ++id) {
            IChogSwapV2.Trade memory trade = swap.getTrade(id);
            if (trade.status == IChogSwapV2.Status.Open) {
                sum += _sumOf(trade.offered, t, token);
            }
            for (uint256 pid; pid < swap.proposalCount(id); ++pid) {
                IChogSwapV2.Proposal memory p = swap.getProposal(id, pid);
                if (p.status == IChogSwapV2.ProposalStatus.Active) {
                    sum += _sumOf(p.assets, t, token);
                }
            }
        }
    }

    function _holdsNft(IChogSwapV2.Asset[] memory assets, address token, uint256 tokenId)
        internal
        pure
        returns (bool)
    {
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i].token == token && assets[i].id == tokenId) return true;
        }
        return false;
    }

    /// I1: native balance == Σ open native offered + Σ native credits.
    function invariant_nativeIsFullyAccounted() public view {
        assertEq(
            address(swap).balance,
            _openOffered(IChogSwapV2.AssetType.Native, address(0))
                + _credits(IChogSwapV2.AssetType.Native, address(0), 0)
        );
    }

    /// I2: same for every ERC-20.
    function invariant_erc20IsFullyAccounted() public view {
        assertEq(
            usdc.balanceOf(address(swap)),
            _openOffered(IChogSwapV2.AssetType.ERC20, address(usdc))
                + _credits(IChogSwapV2.AssetType.ERC20, address(usdc), 0)
        );
        assertEq(
            blk.balanceOf(address(swap)),
            _openOffered(IChogSwapV2.AssetType.ERC20, address(blk))
                + _credits(IChogSwapV2.AssetType.ERC20, address(blk), 0)
        );
    }

    /// I3: the contract owns an NFT iff an open trade offers it or an `Active` proposal holds it
    ///     (Chogs are never credited).
    function invariant_nftsAreFullyAccounted() public view {
        uint256 minted = chog.nextTokenId();
        for (uint256 tokenId = 1; tokenId < minted; ++tokenId) {
            bool escrowed;
            for (uint256 id = 1; id <= swap.tradeCount() && !escrowed; ++id) {
                IChogSwapV2.Trade memory t = swap.getTrade(id);
                if (
                    t.status == IChogSwapV2.Status.Open
                        && _holdsNft(t.offered, address(chog), tokenId)
                ) {
                    escrowed = true;
                }
                for (uint256 pid; pid < swap.proposalCount(id) && !escrowed; ++pid) {
                    IChogSwapV2.Proposal memory p = swap.getProposal(id, pid);
                    if (
                        p.status == IChogSwapV2.ProposalStatus.Active
                            && _holdsNft(p.assets, address(chog), tokenId)
                    ) {
                        escrowed = true;
                    }
                }
            }
            assertEq(chog.ownerOf(tokenId) == address(swap), escrowed, "NFT escrow mismatch");
        }
    }

    /// I4 + I5: statuses only move Open → terminal and never come back; ids are contiguous.
    function invariant_statusesMatchHistory() public view {
        uint256 count = swap.tradeCount();
        for (uint256 id = 1; id <= count; ++id) {
            assertEq(uint8(swap.getTrade(id).status), uint8(handler.expectedStatus(id)), "status");
            assertTrue(swap.getTrade(id).status != IChogSwapV2.Status.None);
        }
    }

    /// Proposal statuses only move Active → terminal, match what the handler did, and a
    /// proposal that was accepted belongs to a filled trade.
    function invariant_proposalStatusesMatchHistory() public view {
        for (uint256 id = 1; id <= swap.tradeCount(); ++id) {
            for (uint256 pid; pid < swap.proposalCount(id); ++pid) {
                IChogSwapV2.ProposalStatus s = swap.getProposal(id, pid).status;
                assertEq(uint8(s), uint8(handler.expectedProposal(id, pid)), "proposal status");
                if (s == IChogSwapV2.ProposalStatus.Accepted) {
                    assertEq(uint8(swap.getTrade(id).status), uint8(IChogSwapV2.Status.Filled));
                }
            }
        }
    }

    /// V8: `fillTrade` never settles an open offer, and every valid proposal call succeeds.
    function invariant_openOffersAreOnlySettledByAccept() public view {
        assertEq(handler.ghost_openOfferFilled(), 0, "open offer filled");
        assertEq(handler.ghost_validProposalOpReverted(), 0, "valid proposal call reverted");
    }

    /// I6, I7 and liveness: a valid fill / cancel never reverts, an expired trade never fills,
    /// and every settlement and refund lands where the terms say.
    function invariant_settlementIsCorrectAndLive() public view {
        assertEq(handler.ghost_expiredFills(), 0, "filled after expiry");
        assertEq(handler.ghost_badSettlements(), 0, "bad settlement");
        assertEq(handler.ghost_badRefunds(), 0, "bad refund");
        assertEq(handler.ghost_validFillReverted(), 0, "valid fill reverted");
        assertEq(handler.ghost_validCancelReverted(), 0, "valid cancel reverted");
    }

    function invariant_callSummary() public {
        emit log_named_uint("create", handler.calls("create"));
        emit log_named_uint("fill", handler.calls("fill"));
        emit log_named_uint("cancel", handler.calls("cancel"));
        emit log_named_uint("reclaim", handler.calls("reclaim"));
        emit log_named_uint("claim", handler.calls("claim"));
        emit log_named_uint("offer", handler.calls("offer"));
        emit log_named_uint("propose", handler.calls("propose"));
        emit log_named_uint("accept", handler.calls("accept"));
        emit log_named_uint("reject", handler.calls("reject"));
        emit log_named_uint("withdraw", handler.calls("withdraw"));
    }
}
