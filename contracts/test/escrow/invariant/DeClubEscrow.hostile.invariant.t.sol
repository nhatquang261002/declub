// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeClubEscrow} from "../../../src/DeClubEscrow.sol";
import {IDeClubEscrow} from "../../../src/interfaces/IDeClubEscrow.sol";
import {MockERC20} from "../../../src/mocks/MockERC20.sol";
import {LyingNft, SoftNft} from "../../utils/WeirdTokens.sol";
import {HostileHandler} from "./HostileHandler.sol";

/// @dev I3 against hostile collections (see HostileHandler): the escrow owns a `soft` id exactly
///      when an open trade offers it or an `Active` proposal holds it, never owns a `liar` id,
///      and holds exactly the USDC and fee shares its open trades and proposals account for,
///      however deposits of ids the caller doesn't own, ids already in escrow, NFTs that never
///      move and type-confused assets are mixed in with honest deals.
contract DeClubEscrowHostileInvariantTest is Test {
    uint256 internal constant FEE = 1 ether;

    DeClubEscrow internal swap;
    SoftNft internal soft;
    LyingNft internal liar;
    MockERC20 internal usdc;
    HostileHandler internal handler;
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        swap = new DeClubEscrow(FEE, FEE, treasury, address(0));
        soft = new SoftNft();
        liar = new LyingNft();
        usdc = new MockERC20("USD Coin", "USDC");
        handler = new HostileHandler(swap, soft, liar, usdc);
        targetContract(address(handler));
    }

    /// @dev Every open trade's offered side and every `Active` proposal's assets.
    function _escrowed() internal view returns (IDeClubEscrow.Asset[][] memory sides, uint256 n) {
        uint256 count = swap.tradeCount();
        uint256 cap;
        for (uint256 id = 1; id <= count; ++id) {
            cap += 1 + swap.proposalCount(id);
        }
        sides = new IDeClubEscrow.Asset[][](cap);
        for (uint256 id = 1; id <= count; ++id) {
            IDeClubEscrow.Trade memory t = swap.getTrade(id);
            if (t.status == IDeClubEscrow.Status.Open) sides[n++] = t.offered;
            for (uint256 pid; pid < swap.proposalCount(id); ++pid) {
                IDeClubEscrow.Proposal memory p = swap.getProposal(id, pid);
                if (p.status == IDeClubEscrow.ProposalStatus.Active) sides[n++] = p.assets;
            }
        }
    }

    /// I3 (hostile): owner(soft id) == escrow ⇔ an open trade or Active proposal holds it, and
    ///    no two of them hold the same id.
    function invariant_softIdsAreEscrowedExactlyWhenOffered() public view {
        (IDeClubEscrow.Asset[][] memory sides, uint256 n) = _escrowed();
        for (uint256 tokenId = 1; tokenId <= handler.softCount(); ++tokenId) {
            uint256 holders;
            for (uint256 s; s < n; ++s) {
                for (uint256 i; i < sides[s].length; ++i) {
                    if (sides[s][i].token == address(soft) && sides[s][i].id == tokenId) ++holders;
                }
            }
            assertLe(holders, 1, "one id escrowed twice");
            assertEq(soft.ownerOf(tokenId) == address(swap), holders == 1, "escrow mismatch");
        }
    }

    /// Nothing escrowed is a `liar` id or a type-confused asset.
    function invariant_onlyRealAssetsAreEscrowed() public view {
        (IDeClubEscrow.Asset[][] memory sides, uint256 n) = _escrowed();
        for (uint256 s; s < n; ++s) {
            for (uint256 i; i < sides[s].length; ++i) {
                IDeClubEscrow.Asset memory a = sides[s][i];
                assertTrue(a.token != address(liar), "liar escrowed");
                if (a.token == address(usdc)) {
                    assertEq(uint8(a.assetType), uint8(IDeClubEscrow.AssetType.ERC20));
                }
                if (a.token == address(soft)) {
                    assertEq(uint8(a.assetType), uint8(IDeClubEscrow.AssetType.ERC721));
                }
            }
        }
    }

    /// USDC and native are fully accounted: open offered sides, Active proposals, fee shares
    /// and credits (none are expected here: every recipient accepts).
    function invariant_fungiblesAreFullyAccounted() public view {
        (IDeClubEscrow.Asset[][] memory sides, uint256 n) = _escrowed();
        uint256 usdcHeld;
        uint256 shares;
        for (uint256 s; s < n; ++s) {
            uint256 nfts;
            for (uint256 i; i < sides[s].length; ++i) {
                if (sides[s][i].token == address(usdc)) usdcHeld += sides[s][i].amount;
                if (sides[s][i].assetType == IDeClubEscrow.AssetType.ERC721) ++nfts;
            }
            shares += nfts == 0 ? 1 : nfts;
        }
        assertEq(usdc.balanceOf(address(swap)), usdcHeld, "usdc");
        // Every open trade and Active proposal holds a fee share per NFT it moves (one if none);
        // every fee here is FEE.
        assertEq(address(swap).balance, shares * FEE, "native");
    }

    function invariant_hostileCallsNeverLand() public view {
        assertEq(handler.ghost_hostileAccepted(), 0, "hostile call accepted");
        assertEq(handler.ghost_validReverted(), 0, "honest call reverted");
        assertEq(handler.ghost_badSettlement(), 0, "bad settlement");
    }

    function invariant_callSummary() public {
        emit log_named_uint("create", handler.calls("create"));
        emit log_named_uint("offer", handler.calls("offer"));
        emit log_named_uint("fill", handler.calls("fill"));
        emit log_named_uint("fillRefused", handler.calls("fillRefused"));
        emit log_named_uint("propose", handler.calls("propose"));
        emit log_named_uint("accept", handler.calls("accept"));
        emit log_named_uint("withdraw", handler.calls("withdraw"));
        emit log_named_uint("cancel", handler.calls("cancel"));
        emit log_named_uint("hostileRefused", handler.calls("hostileRefused"));
    }
}
