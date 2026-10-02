// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OnDealV2} from "../../../src/OnDealV2.sol";
import {IOnDealV2} from "../../../src/interfaces/IOnDealV2.sol";
import {MockChog} from "../../../src/mocks/MockChog.sol";
import {MockERC20} from "../../../src/mocks/MockERC20.sol";
import {MonReceiver} from "../../utils/Actors.sol";
import {BlocklistToken} from "../../utils/WeirdTokens.sol";

/// @dev Random create / open offer / propose / accept / reject / withdraw / fill / cancel / reclaim /
///      claim / block / warp sequences over 3 EOAs and
///      1 MON-rejecting contract, trading native + two ERC-20s (one with a blocklist) + Chogs.
///      The invariants recompute escrow from the trades themselves, so the only ghost state is
///      the expected status per trade and a few counters that must stay 0.
///      The swap charges a protocol fee: every create, proposal and fill sends it with the call,
///      and the fee recipient is a MON-rejecting contract at times, so its credit is exercised.
///      The fee admin changes the fee as the run goes, so trades carry different fees and every
///      side must pay, and get back, its own trade's.
contract Handler is Test {
    OnDealV2 public immutable swap;
    MockChog public immutable chog;
    MockERC20 public immutable usdc;
    BlocklistToken public immutable blk;

    MonReceiver public immutable treasury;
    address public immutable feeAdmin;

    address[] public actors;
    mapping(uint256 tradeId => IOnDealV2.Status) public expectedStatus;
    mapping(uint256 tradeId => mapping(uint256 proposalId => IOnDealV2.ProposalStatus)) public
        expectedProposal;

    uint256 public ghost_expiredFills; // I6
    uint256 public ghost_badSettlements; // fill moved assets to the wrong place
    uint256 public ghost_badRefunds; // I7
    uint256 public ghost_validFillReverted; // liveness: a valid fill must not revert
    uint256 public ghost_validCancelReverted; // a maker can always cancel
    uint256 public ghost_openOfferFilled; // V8: fillTrade must never settle an open offer
    uint256 public ghost_validProposalOpReverted; // valid propose / accept / reject / withdraw
    uint256 public ghost_completed; // deals that completed: a fill or an accepted proposal
    uint256 public ghost_feesCharged; // V9: 2 × the trade's fee per completed deal

    mapping(bytes32 => uint256) public calls;

    constructor(
        OnDealV2 swap_,
        MockChog chog_,
        MockERC20 usdc_,
        BlocklistToken blk_,
        MonReceiver treasury_,
        address feeAdmin_
    ) {
        swap = swap_;
        treasury = treasury_;
        feeAdmin = feeAdmin_;
        chog = chog_;
        usdc = usdc_;
        blk = blk_;

        actors.push(makeAddr("actor0"));
        actors.push(makeAddr("actor1"));
        actors.push(makeAddr("actor2"));
        actors.push(address(new MonReceiver())); // rejects MON → exercises native credits

        for (uint256 i; i < actors.length; ++i) {
            address a = actors[i];
            chog.mint(a, 6);
            usdc.mint(a, 100_000 ether);
            blk.mint(a, 100_000 ether);
            vm.deal(a, 10_000 ether);
            vm.startPrank(a);
            chog.setApprovalForAll(address(swap), true);
            usdc.approve(address(swap), type(uint256).max);
            blk.approve(address(swap), type(uint256).max);
            vm.stopPrank();
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    // ─────────────────────────────────────────────── actions

    function create(
        uint256 makerSeed,
        uint256 offeredMask,
        uint256 requestedMask,
        uint256 nftSeed,
        uint256 amountSeed,
        uint256 expirySeed,
        bool restrictTaker
    ) external {
        address maker = _actor(makerSeed);
        address counterparty = _actor(makerSeed + 1 + (requestedMask >> 8) % 3);

        // bit0 native, bit1 usdc, bit2 blk. The requested side never repeats an offered token.
        offeredMask &= 7;
        requestedMask = (requestedMask & 7) & ~offeredMask;

        uint256 nOfferedNft = bound(nftSeed, 0, 2);
        uint256 nRequestedNft = bound(nftSeed >> 8, 0, 2);
        IOnDealV2.Asset[] memory offered = _side(maker, offeredMask, nOfferedNft, amountSeed);
        IOnDealV2.Asset[] memory requested =
            _side(counterparty, requestedMask, nRequestedNft, amountSeed >> 16);
        if (offered.length == 0 || requested.length == 0) return;

        // Read before the prank: any call, even a view, would spend it.
        uint256 value = _sum(offered, 0) + swap.fee();
        uint64 expiry =
            expirySeed % 3 == 0 ? 0 : uint64(block.timestamp + bound(expirySeed, 1, 3 days));
        address taker = restrictTaker ? counterparty : address(0);

        vm.prank(maker);
        uint256 id = swap.createTrade{value: value}(offered, requested, taker, expiry);
        expectedStatus[id] = IOnDealV2.Status.Open;
        calls["create"]++;
    }

    function fill(uint256 tradeSeed, uint256 takerSeed) external {
        (uint256 id, IOnDealV2.Trade memory t, bool ok) = _openTrade(tradeSeed);
        if (!ok) return;

        address taker = t.taker != address(0) ? t.taker : _actor(takerSeed);
        if (t.requested.length == 0) {
            // V8: an open offer has no ask, so filling it must always revert.
            vm.prank(taker == t.maker ? _actor(takerSeed + 1) : taker);
            try swap.fillTrade(id) {
                ghost_openOfferFilled++;
            } catch {}
            return;
        }
        if (taker == t.maker || !_canPay(taker, t)) return;

        bool expired = swap.isExpired(id);
        uint256[3] memory makerBefore = _holdings(t.maker);
        uint256[3] memory takerBefore = _holdings(taker);
        vm.prank(taker);
        try swap.fillTrade{value: _sum(t.requested, 0) + t.fee}(id) {
            if (expired) ghost_expiredFills++;
            expectedStatus[id] = IOnDealV2.Status.Filled;
            _checkNfts(t.offered, taker);
            _checkNfts(t.requested, t.maker);
            // The maker gains the requested side; the taker gains the offered side and pays the
            // requested one. A rejected payout shows up as a credit, which _holdings includes.
            if (!_gained(t.maker, makerBefore, t.requested, new IOnDealV2.Asset[](0), 0, 0)) {
                ghost_badSettlements++;
            }
            // The taker also sends its fee share; the maker's was sent when it created the trade.
            if (!_gained(taker, takerBefore, t.offered, t.requested, 0, t.fee)) {
                ghost_badSettlements++;
            }
            ghost_completed++;
            ghost_feesCharged += 2 * uint256(t.fee);
            calls["fill"]++;
        } catch {
            if (!expired) ghost_validFillReverted++;
        }
    }

    function createOffer(
        uint256 makerSeed,
        uint256 offeredMask,
        uint256 nftSeed,
        uint256 amountSeed,
        uint256 expirySeed,
        bool restrictTaker
    ) external {
        address maker = _actor(makerSeed);
        address counterparty = _actor(makerSeed + 1 + (offeredMask >> 8) % 3);
        IOnDealV2.Asset[] memory offered =
            _side(maker, offeredMask & 7, bound(nftSeed, 0, 2), amountSeed);
        if (offered.length == 0) return;

        uint64 expiry =
            expirySeed % 3 == 0 ? 0 : uint64(block.timestamp + bound(expirySeed, 1, 3 days));
        uint256 value = _sum(offered, 0) + swap.fee();
        vm.prank(maker);
        uint256 id = swap.createOpenOffer{value: value}(
            offered, restrictTaker ? counterparty : address(0), expiry, "note"
        );
        expectedStatus[id] = IOnDealV2.Status.Open;
        calls["offer"]++;
    }

    function propose(
        uint256 tradeSeed,
        uint256 proposerSeed,
        uint256 mask,
        uint256 nftSeed,
        uint256 amountSeed
    ) external {
        (uint256 id, IOnDealV2.Trade memory t, bool ok) = _openTrade(tradeSeed);
        if (!ok || t.requested.length != 0 || swap.isExpired(id)) return;

        address proposer = t.taker != address(0) ? t.taker : _actor(proposerSeed);
        if (proposer == t.maker) return;
        // A proposal never repeats an asset the maker offers (SameAssetBothSides).
        mask = (mask & 7) & ~_maskOf(t.offered);
        IOnDealV2.Asset[] memory assets = _side(proposer, mask, bound(nftSeed, 0, 2), amountSeed);
        if (assets.length == 0) return;

        vm.prank(proposer);
        try swap.propose{value: _sum(assets, 0) + t.fee}(id, assets) returns (uint256 pid) {
            if (pid != swap.proposalCount(id) - 1) ghost_validProposalOpReverted++;
            expectedProposal[id][pid] = IOnDealV2.ProposalStatus.Active;
            calls["propose"]++;
        } catch {
            ghost_validProposalOpReverted++;
        }
    }

    function acceptProposal(uint256 tradeSeed, uint256 proposalSeed) external {
        (uint256 id, IOnDealV2.Trade memory t, bool ok) = _openTrade(tradeSeed);
        if (!ok || t.requested.length != 0 || swap.isExpired(id)) return;
        uint256 n = swap.proposalCount(id);
        if (n == 0) return;
        uint256 pid = proposalSeed % n;
        IOnDealV2.Proposal memory p = swap.getProposal(id, pid);
        if (p.status != IOnDealV2.ProposalStatus.Active) return;

        uint256[3] memory makerBefore = _holdings(t.maker);
        uint256[3] memory proposerBefore = _holdings(p.proposer);
        vm.prank(t.maker);
        try swap.acceptProposal(id, pid) {
            expectedStatus[id] = IOnDealV2.Status.Filled;
            expectedProposal[id][pid] = IOnDealV2.ProposalStatus.Accepted;
            _checkNfts(p.assets, t.maker);
            _checkNfts(t.offered, p.proposer);
            IOnDealV2.Asset[] memory none = new IOnDealV2.Asset[](0);
            if (!_gained(t.maker, makerBefore, p.assets, none, 0, 0)) ghost_badSettlements++;
            if (!_gained(p.proposer, proposerBefore, t.offered, none, 0, 0)) {
                ghost_badSettlements++;
            }
            ghost_completed++;
            ghost_feesCharged += 2 * uint256(t.fee);
            calls["accept"]++;
        } catch {
            ghost_validProposalOpReverted++;
        }
    }

    function rejectProposal(uint256 tradeSeed, uint256 proposalSeed) external {
        (uint256 id, IOnDealV2.Trade memory t, bool ok) = _openTrade(tradeSeed);
        if (!ok || t.requested.length != 0) return;
        uint256 n = swap.proposalCount(id);
        if (n == 0) return;
        uint256 pid = proposalSeed % n;
        IOnDealV2.Proposal memory p = swap.getProposal(id, pid);
        if (p.status != IOnDealV2.ProposalStatus.Active) return;

        uint256[3] memory before = _holdings(p.proposer);
        vm.prank(t.maker);
        try swap.rejectProposal(id, pid) {
            expectedProposal[id][pid] = IOnDealV2.ProposalStatus.Rejected;
            _checkNfts(p.assets, p.proposer);
            if (!_gained(p.proposer, before, p.assets, new IOnDealV2.Asset[](0), t.fee, 0)) {
                ghost_badRefunds++;
            }
            calls["reject"]++;
        } catch {
            ghost_validProposalOpReverted++;
        }
    }

    function withdrawProposal(uint256 tradeSeed, uint256 proposalSeed) external {
        uint256 count = swap.tradeCount();
        if (count == 0) return;
        uint256 id = (tradeSeed % count) + 1;
        uint256 n = swap.proposalCount(id);
        if (n == 0) return;
        uint256 pid = proposalSeed % n;
        IOnDealV2.Proposal memory p = swap.getProposal(id, pid);
        if (p.status != IOnDealV2.ProposalStatus.Active) return;
        uint256 share = swap.getTrade(id).fee;

        uint256[3] memory before = _holdings(p.proposer);
        vm.prank(p.proposer);
        try swap.withdrawProposal(id, pid) {
            expectedProposal[id][pid] = IOnDealV2.ProposalStatus.Withdrawn;
            _checkNfts(p.assets, p.proposer);
            if (!_gained(p.proposer, before, p.assets, new IOnDealV2.Asset[](0), share, 0)) {
                ghost_badRefunds++;
            }
            calls["withdraw"]++;
        } catch {
            ghost_validProposalOpReverted++;
        }
    }

    function cancel(uint256 tradeSeed) external {
        (uint256 id, IOnDealV2.Trade memory t, bool ok) = _openTrade(tradeSeed);
        if (!ok) return;

        uint256[3] memory before = _holdings(t.maker);
        vm.prank(t.maker);
        try swap.cancelTrade(id) {
            expectedStatus[id] = IOnDealV2.Status.Cancelled;
            _checkNfts(t.offered, t.maker);
            if (!_gained(t.maker, before, t.offered, new IOnDealV2.Asset[](0), t.fee, 0)) {
                ghost_badRefunds++;
            }
            calls["cancel"]++;
        } catch {
            ghost_validCancelReverted++;
        }
    }

    function reclaim(uint256 tradeSeed, uint256 callerSeed) external {
        (uint256 id, IOnDealV2.Trade memory t, bool ok) = _openTrade(tradeSeed);
        if (!ok || !swap.isExpired(id)) return;

        address caller = _actor(callerSeed);
        uint256[3] memory makerBefore = _holdings(t.maker);
        uint256[3] memory callerBefore = _holdings(caller);
        vm.prank(caller);
        try swap.reclaimExpired(id) {
            expectedStatus[id] = IOnDealV2.Status.Cancelled;
            _checkNfts(t.offered, t.maker);
            if (!_gained(t.maker, makerBefore, t.offered, new IOnDealV2.Asset[](0), t.fee, 0)) {
                ghost_badRefunds++;
            }
            // A caller who isn't the maker gets nothing.
            if (caller != t.maker) {
                uint256[3] memory callerAfter = _holdings(caller);
                for (uint256 i; i < 3; ++i) {
                    if (callerAfter[i] != callerBefore[i]) ghost_badRefunds++;
                }
            }
            calls["reclaim"]++;
        } catch {
            ghost_badRefunds++; // an expired open trade must always be reclaimable
        }
    }

    function claim(uint256 actorSeed, uint256 kind) external {
        address who = _actor(actorSeed);
        (IOnDealV2.AssetType t, address token) = _fungible(kind);
        vm.prank(who);
        try swap.claim(t, token, 0) {
            calls["claim"]++;
        } catch {}
    }

    function setBlocked(uint256 actorSeed, bool blocked) external {
        blk.setBlocked(_actor(actorSeed), blocked);
        calls["block"]++;
    }

    function acceptMon(bool accept) external {
        MonReceiver(payable(actors[3])).setAccept(accept);
    }

    /// @dev Flips whether the fee recipient takes MON, so fees are paid or credited.
    function acceptFees(bool accept) external {
        treasury.setAccept(accept);
    }

    /// @dev The fee admin moves the fee anywhere up to the ceiling. A raise waits out its delay
    ///      and is applied, so it takes effect within the run.
    function changeFee(uint256 seed) external {
        uint256 newFee = bound(seed, 0, swap.MAX_FEE());
        bool raise = newFee > swap.fee();
        vm.prank(feeAdmin);
        swap.setFee(newFee);
        if (raise) {
            vm.warp(block.timestamp + swap.FEE_RAISE_DELAY());
            vm.prank(feeAdmin);
            swap.applyFee();
        }
        calls["changeFee"]++;
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    // ─────────────────────────────────────────────── helpers

    /// @dev Native, usdc, blk: wallet balance plus anything credited for `claim`.
    function _holdings(address who) internal view returns (uint256[3] memory h) {
        h[0] = who.balance + swap.claimable(who, IOnDealV2.AssetType.Native, address(0), 0);
        h[1] = usdc.balanceOf(who)
            + swap.claimable(who, IOnDealV2.AssetType.ERC20, address(usdc), 0);
        h[2] =
            blk.balanceOf(who) + swap.claimable(who, IOnDealV2.AssetType.ERC20, address(blk), 0);
    }

    function _sum(IOnDealV2.Asset[] memory assets, uint256 k)
        internal
        view
        returns (uint256 total)
    {
        for (uint256 i; i < assets.length; ++i) {
            IOnDealV2.Asset memory a = assets[i];
            bool match_ = k == 0
                ? a.assetType == IOnDealV2.AssetType.Native
                : a.token == (k == 1 ? address(usdc) : address(blk));
            if (match_) total += a.amount;
        }
    }

    /// @dev holdings(after) == holdings(before) + Σ gained − Σ paid, per fungible. `feeBack` is a
    ///      fee share refunded in the call and `feePaid` one sent with it, both native.
    function _gained(
        address who,
        uint256[3] memory before,
        IOnDealV2.Asset[] memory gained,
        IOnDealV2.Asset[] memory paid,
        uint256 feeBack,
        uint256 feePaid
    ) internal view returns (bool) {
        uint256[3] memory nowHeld = _holdings(who);
        for (uint256 k; k < 3; ++k) {
            uint256 plus = _sum(gained, k) + (k == 0 ? feeBack : 0);
            uint256 minus = _sum(paid, k) + (k == 0 ? feePaid : 0);
            if (nowHeld[k] + minus != before[k] + plus) return false;
        }
        return true;
    }

    function _checkNfts(IOnDealV2.Asset[] memory assets, address expectedOwner) internal {
        for (uint256 i; i < assets.length; ++i) {
            if (
                assets[i].assetType == IOnDealV2.AssetType.ERC721
                    && chog.ownerOf(assets[i].id) != expectedOwner
            ) {
                ghost_badSettlements++;
            }
        }
    }

    /// @dev Bitmask (bit0 native, bit1 usdc, bit2 blk) of the fungibles in `assets`.
    function _maskOf(IOnDealV2.Asset[] memory assets) internal view returns (uint256 mask) {
        for (uint256 i; i < assets.length; ++i) {
            IOnDealV2.Asset memory a = assets[i];
            if (a.assetType == IOnDealV2.AssetType.Native) mask |= 1;
            else if (a.token == address(usdc)) mask |= 2;
            else if (a.token == address(blk)) mask |= 4;
        }
    }

    function _fungible(uint256 kind) internal view returns (IOnDealV2.AssetType, address) {
        kind %= 3;
        if (kind == 0) return (IOnDealV2.AssetType.Native, address(0));
        if (kind == 1) return (IOnDealV2.AssetType.ERC20, address(usdc));
        return (IOnDealV2.AssetType.ERC20, address(blk));
    }

    function _side(address owner, uint256 mask, uint256 nftCount, uint256 amountSeed)
        internal
        view
        returns (IOnDealV2.Asset[] memory out)
    {
        uint256 bal = chog.balanceOf(owner);
        if (nftCount > bal) nftCount = bal;
        uint256 n = nftCount;
        for (uint256 b; b < 3; ++b) {
            if (mask & (1 << b) != 0) ++n;
        }
        out = new IOnDealV2.Asset[](n);
        uint256 k;
        for (uint256 b; b < 3; ++b) {
            if (mask & (1 << b) == 0) continue;
            (IOnDealV2.AssetType t, address token) = _fungible(b);
            uint256 amount = bound(amountSeed >> (b * 4), 1, 50) * 1 ether;
            out[k++] = IOnDealV2.Asset(t, token, 0, amount);
        }
        for (uint256 i; i < nftCount; ++i) {
            out[k++] = IOnDealV2.Asset(
                IOnDealV2.AssetType.ERC721, address(chog), chog.tokenOfOwnerByIndex(owner, i), 1
            );
        }
    }

    /// @dev Only attempt fills a taker can really pay, so a revert means a bug.
    function _canPay(address taker, IOnDealV2.Trade memory t) internal view returns (bool) {
        for (uint256 i; i < t.requested.length; ++i) {
            IOnDealV2.Asset memory a = t.requested[i];
            if (a.assetType == IOnDealV2.AssetType.Native) {
                if (taker.balance < a.amount + t.fee) return false;
            } else if (a.assetType == IOnDealV2.AssetType.ERC20) {
                if (IERC20Like(a.token).balanceOf(taker) < a.amount) return false;
                // A blocked maker can't receive the blocklist token, which reverts the fill.
                if (a.token == address(blk) && blk.blocked(t.maker)) return false;
            } else if (chog.ownerOf(a.id) != taker) {
                return false;
            }
        }
        return true;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _openTrade(uint256 seed)
        internal
        view
        returns (uint256 id, IOnDealV2.Trade memory t, bool ok)
    {
        uint256 count = swap.tradeCount();
        if (count == 0) return (0, t, false);
        id = (seed % count) + 1;
        t = swap.getTrade(id);
        ok = t.status == IOnDealV2.Status.Open;
    }
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
}
