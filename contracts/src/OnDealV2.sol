// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IOnDealV2} from "./interfaces/IOnDealV2.sol";
import {FeeAdmin} from "./FeeAdmin.sol";

/// @title OnDealV2: generic multi-asset OTC escrow
/// @notice See IOnDealV2 for the behaviour spec, docs/adr/0005-generic-asset-model.md and
///         docs/adr/0007-open-offers.md for the reasoning.
/// @dev No upgradeability, no token allowlist, and an admin over the fee amount only (FeeAdmin).
///      Every mutating function is nonReentrant and follows checks → effects → interactions.
///      Payouts out of escrow never revert: a recipient or token that rejects one gets a credit
///      to `claim` instead.
///      Moving the *taker's* assets to the maker does revert on failure, so a fill is atomic.
///
///      Protocol fee (docs/adr/0015-protocol-fee.md, docs/adr/0018-adjustable-protocol-fee.md):
///      every side of a completed deal pays the same share in native MON, to `FEE_RECIPIENT`.
///      A trade records `fee()` when it is created, and both sides pay that recorded `fee`, so
///      a later change by the fee admin never touches a deal already listed. Each side sends its
///      share with its own assets (`msg.value` = native amount + share), and the contract only
///      *holds* it: both shares are released together when the deal completes (a fill or an
///      accepted proposal) and refunded with that side's escrow on cancel, reclaim, reject and
///      withdraw.
contract OnDealV2 is IOnDealV2, FeeAdmin, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_ASSETS_PER_SIDE = 10;
    uint256 public constant MAX_NOTE_BYTES = 280;
    uint256 public constant MAX_SPEC_BYTES = 1024;
    uint256 public tradeCount;

    mapping(uint256 tradeId => Trade) internal _trades;
    mapping(uint256 tradeId => string) internal _notes;
    mapping(uint256 tradeId => string) internal _traitSpecs;
    mapping(uint256 tradeId => Proposal[]) internal _proposals;
    /// @dev account → keccak256(assetType, token, id) → amount. Native and ERC-20 amounts add
    ///      up; an NFT credit is 1.
    mapping(address account => mapping(bytes32 assetKey => uint256 amount)) internal _credits;

    /// @param initialFee Per-side fee in wei for deals created from now on. 0 charges nothing.
    /// @param maxFee Ceiling the fee admin can never go above, at most `MAX_FEE_LIMIT`.
    /// @param feeRecipient Receives the fees. Required when `maxFee` is not 0.
    /// @param admin May change the fee within `maxFee`. Zero fixes it for good.
    constructor(uint256 initialFee, uint256 maxFee, address feeRecipient, address admin)
        FeeAdmin(initialFee, maxFee, feeRecipient, admin)
    {}

    // ─────────────────────────────────────────────────────────────── Mutating

    /// @inheritdoc IOnDealV2
    function createTrade(
        Asset[] calldata offered,
        Asset[] calldata requested,
        address taker,
        uint64 expiry
    ) external payable nonReentrant returns (uint256 tradeId) {
        tradeId = _create(offered, requested, taker, expiry, "");
    }

    /// @inheritdoc IOnDealV2
    function createTraitTrade(
        Asset[] calldata offered,
        Asset[] calldata requested,
        address taker,
        uint64 expiry,
        string calldata spec
    ) external payable nonReentrant returns (uint256 tradeId) {
        uint256 specLength = bytes(spec).length;
        if (specLength == 0 || specLength > MAX_SPEC_BYTES) {
            revert BadTraitSpec(specLength, MAX_SPEC_BYTES);
        }
        tradeId = _create(offered, requested, taker, expiry, spec);
    }

    /// @inheritdoc IOnDealV2
    function createOpenOffer(
        Asset[] calldata offered,
        address taker,
        uint64 expiry,
        string calldata note
    ) external payable nonReentrant returns (uint256 tradeId) {
        uint256 expectedValue = _validateSide(offered, false) + _fee;
        if (msg.value != expectedValue) revert WrongNativeAmount(expectedValue, msg.value);
        // forge-lint: disable-next-line(block-timestamp)
        if (expiry != 0 && expiry <= block.timestamp) revert ExpiryInPast(expiry);
        uint256 noteLength = bytes(note).length;
        if (noteLength > MAX_NOTE_BYTES) revert NoteTooLong(noteLength, MAX_NOTE_BYTES);

        tradeId = _newTrade(offered, taker, expiry);

        emit TradeCreated(tradeId, msg.sender, taker, offered, new Asset[](0), expiry);
        if (noteLength != 0) {
            _notes[tradeId] = note;
            emit OfferNote(tradeId, note);
        }

        _depositAll(offered);
    }

    /// @inheritdoc IOnDealV2
    function propose(uint256 tradeId, Asset[] calldata assets)
        external
        payable
        nonReentrant
        returns (uint256 proposalId)
    {
        Trade storage t = _trades[tradeId];
        if (t.status != Status.Open) revert TradeNotOpen(tradeId);
        if (t.requested.length != 0) revert NotOpenOffer(tradeId);
        if (_isExpired(t)) revert TradeIsExpired(tradeId);
        address taker = t.taker;
        if (taker != address(0) && msg.sender != taker) revert NotAllowedTaker(tradeId);
        if (msg.sender == t.maker) revert SelfPropose(tradeId);

        uint256 expectedValue = _validateSide(assets, false) + t.fee;
        _validateNoOverlap(t.offered, assets);
        if (msg.value != expectedValue) revert WrongNativeAmount(expectedValue, msg.value);

        Proposal[] storage all = _proposals[tradeId];
        proposalId = all.length;
        Proposal storage p = all.push();
        p.proposer = msg.sender;
        p.status = ProposalStatus.Active;
        for (uint256 i; i < assets.length; ++i) {
            p.assets.push(assets[i]);
        }

        emit ProposalCreated(tradeId, proposalId, msg.sender, assets);

        _depositAll(assets);
    }

    /// @inheritdoc IOnDealV2
    function withdrawProposal(uint256 tradeId, uint256 proposalId) external nonReentrant {
        Proposal storage p = _proposal(tradeId, proposalId);
        if (msg.sender != p.proposer) revert NotProposer(tradeId, proposalId);
        if (p.status != ProposalStatus.Active) revert ProposalNotActive(tradeId, proposalId);

        p.status = ProposalStatus.Withdrawn;
        emit ProposalWithdrawn(tradeId, proposalId);

        _payoutAll(p.assets, msg.sender);
        _refundFee(msg.sender, _trades[tradeId].fee);
    }

    /// @inheritdoc IOnDealV2
    function rejectProposal(uint256 tradeId, uint256 proposalId) external nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != Status.Open) revert TradeNotOpen(tradeId);
        if (msg.sender != t.maker) revert NotMaker(tradeId);
        Proposal storage p = _proposal(tradeId, proposalId);
        if (p.status != ProposalStatus.Active) revert ProposalNotActive(tradeId, proposalId);

        p.status = ProposalStatus.Rejected;
        emit ProposalRejected(tradeId, proposalId);

        address proposer = p.proposer;
        _payoutAll(p.assets, proposer);
        _refundFee(proposer, t.fee);
    }

    /// @inheritdoc IOnDealV2
    function acceptProposal(uint256 tradeId, uint256 proposalId) external nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != Status.Open) revert TradeNotOpen(tradeId);
        if (msg.sender != t.maker) revert NotMaker(tradeId);
        if (_isExpired(t)) revert TradeIsExpired(tradeId);
        Proposal storage p = _proposal(tradeId, proposalId);
        if (p.status != ProposalStatus.Active) revert ProposalNotActive(tradeId, proposalId);

        address proposer = p.proposer;
        t.status = Status.Filled;
        p.status = ProposalStatus.Accepted;
        emit TradeFilled(tradeId, msg.sender, proposer);
        emit ProposalAccepted(tradeId, proposalId);

        // Both sides, and both fee shares, are already in escrow, so no payout can revert: a
        // rejected one is credited for `claim`.
        _payoutAll(p.assets, msg.sender);
        _payoutAll(t.offered, proposer);
        _chargeFee(tradeId, t.fee);
    }

    /// @inheritdoc IOnDealV2
    function fillTrade(uint256 tradeId) external payable nonReentrant {
        _fill(tradeId, new TraitFill[](0));
    }

    /// @inheritdoc IOnDealV2
    function fillTraitTrade(uint256 tradeId, TraitFill[] calldata fills)
        external
        payable
        nonReentrant
    {
        _fill(tradeId, fills);
    }

    /// @inheritdoc IOnDealV2
    function cancelTrade(uint256 tradeId) external nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != Status.Open) revert TradeNotOpen(tradeId);
        if (msg.sender != t.maker) revert NotMaker(tradeId);

        t.status = Status.Cancelled;
        emit TradeCancelled(tradeId, t.maker);

        _payoutAll(t.offered, t.maker);
        _refundFee(t.maker, t.fee);
    }

    /// @inheritdoc IOnDealV2
    function reclaimExpired(uint256 tradeId) external nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != Status.Open) revert TradeNotOpen(tradeId);
        if (!_isExpired(t)) revert TradeNotExpired(tradeId);

        t.status = Status.Cancelled;
        emit TradeReclaimed(tradeId, t.maker, msg.sender);

        _payoutAll(t.offered, t.maker);
        _refundFee(t.maker, t.fee);
    }

    /// @inheritdoc IOnDealV2
    function claim(AssetType assetType, address token, uint256 id) external nonReentrant {
        bytes32 key = _key(assetType, token, id);
        uint256 amount = _credits[msg.sender][key];
        if (amount == 0) revert NothingToClaim();

        _credits[msg.sender][key] = 0;
        emit Claimed(msg.sender, token, assetType, id, amount);

        // Reverting restores the credit, so a token that still rejects the transfer loses nothing.
        if (!_transferOut(assetType, token, id, amount, msg.sender)) revert ClaimFailed();
    }

    // ─────────────────────────────────────────────────────────────── Views

    /// @inheritdoc IOnDealV2
    function getTrade(uint256 tradeId) external view returns (Trade memory) {
        return _trades[tradeId];
    }

    /// @inheritdoc IOnDealV2
    function isExpired(uint256 tradeId) external view returns (bool) {
        return _isExpired(_trades[tradeId]);
    }

    /// @inheritdoc IOnDealV2
    function offerNote(uint256 tradeId) external view returns (string memory) {
        return _notes[tradeId];
    }

    /// @inheritdoc IOnDealV2
    function traitSpec(uint256 tradeId) external view returns (string memory) {
        return _traitSpecs[tradeId];
    }

    /// @inheritdoc IOnDealV2
    function proposalCount(uint256 tradeId) external view returns (uint256) {
        return _proposals[tradeId].length;
    }

    /// @inheritdoc IOnDealV2
    function getProposal(uint256 tradeId, uint256 proposalId)
        external
        view
        returns (Proposal memory)
    {
        return _proposal(tradeId, proposalId);
    }

    /// @inheritdoc IOnDealV2
    function getProposals(uint256 tradeId, uint256 offset, uint256 limit)
        external
        view
        returns (Proposal[] memory page)
    {
        Proposal[] storage all = _proposals[tradeId];
        uint256 total = all.length;
        if (offset >= total) return page;
        uint256 n = total - offset;
        if (limit < n) n = limit;
        page = new Proposal[](n);
        for (uint256 i; i < n; ++i) {
            page[i] = all[offset + i];
        }
    }

    /// @inheritdoc IOnDealV2
    function claimable(address account, AssetType assetType, address token, uint256 id)
        external
        view
        returns (uint256)
    {
        return _credits[account][_key(assetType, token, id)];
    }

    // ─────────────────────────────────────────────────────────────── Validation

    /// @dev Checks size, field rules and duplicates. `allowTrait` admits `ERC721Trait` assets (the
    ///      requested side of a trait trade only). Returns the native amount on the side.
    // Reverting on the first bad asset is the point of this loop.
    // forge-lint: disable-next-item(require-revert-in-loop)
    function _validateSide(Asset[] calldata assets, bool allowTrait)
        private
        view
        returns (uint256 native)
    {
        uint256 n = assets.length;
        if (n == 0) revert EmptySide();
        if (n > MAX_ASSETS_PER_SIDE) revert TooManyAssets(n, MAX_ASSETS_PER_SIDE);

        for (uint256 i; i < n; ++i) {
            Asset calldata a = assets[i];
            if (a.assetType == AssetType.Native) {
                if (a.token != address(0) || a.id != 0 || a.amount == 0) revert InvalidAsset(i);
                native = a.amount;
            } else if (a.assetType == AssetType.ERC20) {
                if (a.token.code.length == 0 || a.id != 0 || a.amount == 0 || _isNft(a.token)) {
                    revert InvalidAsset(i);
                }
            } else if (a.assetType == AssetType.ERC721) {
                if (a.token.code.length == 0 || a.amount != 1 || !_isNft(a.token)) {
                    revert InvalidAsset(i);
                }
            } else {
                // A trait set is only ever something a taker can hand over.
                if (
                    !allowTrait || a.token.code.length == 0 || a.id == 0 || a.amount == 0
                        || a.amount > MAX_ASSETS_PER_SIDE || !_isNft(a.token)
                ) revert InvalidAsset(i);
            }
            for (uint256 j; j < i; ++j) {
                if (_same(assets[j], a)) revert DuplicateAsset(i);
            }
        }
    }

    /// @dev An asset on both sides can never be filled: the maker's copy is in escrow and the
    ///      taker would have to hand over the same thing they receive.
    // forge-lint: disable-next-item(require-revert-in-loop)
    function _validateNoOverlap(Asset[] calldata offered, Asset[] calldata requested) private pure {
        for (uint256 i; i < offered.length; ++i) {
            for (uint256 j; j < requested.length; ++j) {
                if (_same(offered[i], requested[j])) revert SameAssetBothSides(i, j);
            }
        }
    }

    /// @dev A proposal can't contain an asset the maker offers, for the same reason as above.
    // forge-lint: disable-next-item(require-revert-in-loop)
    function _validateNoOverlap(Asset[] storage offered, Asset[] calldata proposed) private view {
        for (uint256 i; i < offered.length; ++i) {
            for (uint256 j; j < proposed.length; ++j) {
                Asset storage a = offered[i];
                Asset calldata b = proposed[j];
                if (a.assetType == b.assetType && a.token == b.token && a.id == b.id) {
                    revert SameAssetBothSides(i, j);
                }
            }
        }
    }

    function _same(Asset calldata a, Asset calldata b) private pure returns (bool) {
        return a.assetType == b.assetType && a.token == b.token && a.id == b.id;
    }

    /// @dev ERC-20 and ERC-721 `transferFrom` share a selector, so an asset's declared type has to
    ///      match the contract behind it. Otherwise an ask for "6 units of an ERC-20" at an NFT
    ///      collection would pull NFT #6 from a taker who approved the collection.
    function _isNft(address token) private view returns (bool) {
        return ERC165Checker.supportsInterface(token, type(IERC721).interfaceId);
    }

    // ─────────────────────────────────────────────────────────────── Internals

    function _create(
        Asset[] calldata offered,
        Asset[] calldata requested,
        address taker,
        uint64 expiry,
        string memory spec
    ) private returns (uint256 tradeId) {
        // Only `createTraitTrade` passes a spec (it rejects an empty one), and only it admits
        // trait assets.
        bool trait = bytes(spec).length != 0;
        uint256 expectedValue = _validateSide(offered, false) + _fee;
        _validateSide(requested, trait);
        if (trait && _countTrait(requested) == 0) revert NoTraitAsset();
        _validateNoOverlap(offered, requested);
        if (msg.value != expectedValue) revert WrongNativeAmount(expectedValue, msg.value);
        // forge-lint: disable-next-line(block-timestamp)
        if (expiry != 0 && expiry <= block.timestamp) revert ExpiryInPast(expiry);

        tradeId = _newTrade(offered, taker, expiry);
        Asset[] storage stored = _trades[tradeId].requested;
        for (uint256 i; i < requested.length; ++i) {
            stored.push(requested[i]);
        }

        emit TradeCreated(tradeId, msg.sender, taker, offered, requested, expiry);
        if (trait) {
            _traitSpecs[tradeId] = spec;
            emit TraitSpec(tradeId, spec);
        }

        _depositAll(offered);
    }

    function _fill(uint256 tradeId, TraitFill[] memory fills) private {
        Trade storage t = _trades[tradeId];
        if (t.status != Status.Open) revert TradeNotOpen(tradeId);
        // An open offer has no ask. Without this a caller would take the escrow for free.
        if (t.requested.length == 0) revert OpenOfferNoFill(tradeId);
        if (_isExpired(t)) revert TradeIsExpired(tradeId);
        address maker = t.maker;
        address taker = t.taker;
        if (taker != address(0) && msg.sender != taker) revert NotAllowedTaker(tradeId);
        if (msg.sender == maker) revert SelfFill(tradeId);
        uint256 expectedValue = _nativeAmount(t.requested) + t.fee;
        if (msg.value != expectedValue) revert WrongNativeAmount(expectedValue, msg.value);
        // Every proof is checked before anything changes or moves.
        _verifyTraitFills(tradeId, t.requested, fills);

        t.status = Status.Filled;
        // forge-lint: disable-next-line(reentrancy-events)
        emit TradeFilled(tradeId, maker, msg.sender);

        // The taker's side goes straight to the maker. A failing transfer reverts the fill.
        Asset[] storage requested = t.requested;
        uint256 traitIndex = 0;
        for (uint256 i; i < requested.length; ++i) {
            Asset storage a = requested[i];
            if (a.assetType == AssetType.Native) {
                _payout(maker, a);
            } else if (a.assetType == AssetType.ERC20) {
                // forge-lint: disable-next-line(calls-loop)
                IERC20(a.token).safeTransferFrom(msg.sender, maker, a.amount);
            } else if (a.assetType == AssetType.ERC721) {
                _moveNft(a.token, msg.sender, maker, a.id);
            } else {
                uint256[] memory ids = fills[traitIndex++].tokenIds;
                for (uint256 k; k < ids.length; ++k) {
                    _moveNft(a.token, msg.sender, maker, ids[k]);
                }
            }
        }
        _payoutAll(t.offered, msg.sender);
        _chargeFee(tradeId, t.fee);
    }

    /// @dev `fills[k]` must answer the k-th trait asset: `amount` distinct ids, each with a
    ///      proof into the asset's Merkle root. Leaves are `keccak256(abi.encode(token, id))`
    ///      and the tree is a sorted-pair tree. Owning the ids is proven later, by the transfer.
    // forge-lint: disable-next-item(require-revert-in-loop)
    function _verifyTraitFills(uint256 tradeId, Asset[] storage requested, TraitFill[] memory fills)
        private
        view
    {
        uint256 traitAssets = 0;
        for (uint256 i; i < requested.length; ++i) {
            Asset storage a = requested[i];
            if (a.assetType != AssetType.ERC721Trait) continue;
            if (fills.length == 0) revert TraitFillRequired(tradeId);
            if (traitAssets >= fills.length) revert InvalidTraitFill(traitAssets);

            TraitFill memory f = fills[traitAssets];
            uint256 n = f.tokenIds.length;
            if (n != a.amount || f.proofs.length != n) revert InvalidTraitFill(traitAssets);
            for (uint256 k; k < n; ++k) {
                uint256 id = f.tokenIds[k];
                for (uint256 m; m < k; ++m) {
                    if (f.tokenIds[m] == id) revert InvalidTraitFill(traitAssets);
                }
                bytes32 leaf = keccak256(abi.encode(a.token, id));
                if (!MerkleProof.verify(f.proofs[k], bytes32(a.id), leaf)) {
                    revert InvalidTraitProof(traitAssets, id);
                }
            }
            ++traitAssets;
        }
        if (traitAssets != fills.length) revert InvalidTraitFill(traitAssets);
    }

    function _countTrait(Asset[] calldata assets) private pure returns (uint256 n) {
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i].assetType == AssetType.ERC721Trait) ++n;
        }
    }

    /// @dev Stores the trade header, with the fee in force, and the offered side. The caller adds
    ///      `requested`, emits the creation event and deposits, in that order.
    function _newTrade(Asset[] calldata offered, address taker, uint64 expiry)
        private
        returns (uint256 tradeId)
    {
        tradeId = ++tradeCount;
        Trade storage t = _trades[tradeId];
        t.maker = msg.sender;
        t.expiry = expiry;
        t.status = Status.Open;
        t.taker = taker;
        t.fee = _fee;
        for (uint256 i; i < offered.length; ++i) {
            t.offered.push(offered[i]);
        }
    }

    function _proposal(uint256 tradeId, uint256 proposalId)
        private
        view
        returns (Proposal storage)
    {
        Proposal[] storage all = _proposals[tradeId];
        if (proposalId >= all.length) revert UnknownProposal(tradeId, proposalId);
        return all[proposalId];
    }

    function _depositAll(Asset[] calldata assets) private {
        for (uint256 i; i < assets.length; ++i) {
            _deposit(assets[i]);
        }
    }

    function _isExpired(Trade storage t) private view returns (bool) {
        uint64 expiry = t.expiry;
        // Second-level validator skew is irrelevant for trade expiries measured in hours.
        // forge-lint: disable-next-line(block-timestamp)
        return expiry != 0 && block.timestamp > expiry;
    }

    function _key(AssetType assetType, address token, uint256 id) private pure returns (bytes32) {
        return keccak256(abi.encode(assetType, token, id));
    }

    function _nativeAmount(Asset[] storage assets) private view returns (uint256) {
        for (uint256 i; i < assets.length; ++i) {
            if (assets[i].assetType == AssetType.Native) return assets[i].amount;
        }
        return 0;
    }

    /// @dev Pull one of the maker's offered assets into escrow, and verify it really arrived.
    ///      Native is already here (`msg.value`). The exact-amount check is deliberate: any token
    ///      that delivers a different amount than it was asked to (fee-on-transfer, rebasing)
    ///      would break the escrow accounting, so it's refused.
    // forge-lint: disable-next-item(require-revert-in-loop, incorrect-strict-equality)
    function _deposit(Asset calldata a) private {
        if (a.assetType == AssetType.ERC20) {
            IERC20 token = IERC20(a.token);
            // forge-lint: disable-next-line(calls-loop)
            uint256 before = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), a.amount);
            // forge-lint: disable-next-line(calls-loop)
            if (token.balanceOf(address(this)) - before != a.amount) {
                revert UnsupportedToken(a.token);
            }
        } else if (a.assetType == AssetType.ERC721) {
            _moveNft(a.token, msg.sender, address(this), a.id);
        }
    }

    /// @dev Move an NFT and verify it changed hands. Checking `ownerOf` only afterwards isn't
    ///      enough: with a token whose `transferFrom` silently does nothing, an id the receiver
    ///      already holds (one escrowed for another trade, or one the maker owns) would pass.
    // forge-lint: disable-next-item(calls-loop)
    function _moveNft(address token, address from, address to, uint256 id) private {
        IERC721 nft = IERC721(token);
        if (nft.ownerOf(id) != from) revert NftNotReceived(token, id);
        nft.transferFrom(from, to, id);
        if (nft.ownerOf(id) != to) revert NftNotReceived(token, id);
    }

    function _payoutAll(Asset[] storage assets, address to) private {
        for (uint256 i; i < assets.length; ++i) {
            _payout(to, assets[i]);
        }
    }

    /// @dev Never reverts: if the recipient or the token rejects the transfer, the amount is
    ///      credited for `claim` instead, so one bad party can't block a fill, cancel or reclaim.
    function _payout(address to, Asset storage a) private {
        _pay(to, a.assetType, a.token, a.id, a.amount);
    }

    function _pay(address to, AssetType assetType, address token, uint256 id, uint256 amount)
        private
    {
        if (_transferOut(assetType, token, id, amount, to)) return;

        _credits[to][_key(assetType, token, id)] += amount;
        // Only known after the (failed) call; nonReentrant rules out log fabrication.
        // forge-lint: disable-next-line(reentrancy-events)
        emit AssetCredited(to, token, assetType, id, amount);
    }

    /// @dev A deal completed: both sides' shares (held since each side's own call) go to the
    ///      recipient in one send. Never reverts: a recipient that rejects MON gets a credit.
    function _chargeFee(uint256 tradeId, uint256 share) private {
        if (share == 0) return;
        uint256 amount = 2 * share;
        address to = FEE_RECIPIENT;
        // forge-lint: disable-next-line(reentrancy-events)
        emit FeeCharged(tradeId, to, amount);
        _pay(to, AssetType.Native, address(0), 0, amount);
    }

    /// @dev A side left without a deal: its share goes back with the rest of its escrow.
    function _refundFee(address to, uint256 share) private {
        if (share == 0) return;
        _pay(to, AssetType.Native, address(0), 0, share);
    }

    /// @dev Send from escrow. Returns false instead of reverting. Crediting after a *failed*
    ///      transfer is reentrancy-safe: nothing left the contract, and every entry point is
    ///      nonReentrant.
    function _transferOut(
        AssetType assetType,
        address token,
        uint256 id,
        uint256 amount,
        address to
    ) private returns (bool ok) {
        if (assetType == AssetType.Native) {
            // forge-lint: disable-next-item(arbitrary-send-eth, reentrancy-eth, calls-loop)
            (ok,) = to.call{value: amount}("");
        } else if (assetType == AssetType.ERC20) {
            // forge-lint: disable-next-line(calls-loop)
            ok = IERC20(token).trySafeTransfer(to, amount);
        } else {
            // forge-lint: disable-next-line(calls-loop, reentrancy-no-eth)
            (ok,) = token.call(abi.encodeCall(IERC721.transferFrom, (address(this), to, id)));
        }
    }
}
