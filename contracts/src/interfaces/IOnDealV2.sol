// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFeeAdmin} from "./IFeeAdmin.sol";

/// @title On Deal V2: generic multi-asset OTC escrow
/// @notice The maker escrows up to `MAX_ASSETS_PER_SIDE` assets (native MON, ERC-20, ERC-721, in
///         any mix) and names up to as many assets in return. A taker fills the trade in one
///         transaction: the taker's assets go straight to the maker and the escrow goes to the
///         taker. Taker assets are never held by the contract (docs/adr/0001-atomic-fill.md).
///         A maker can instead open an *open offer* with no ask: takers escrow proposals and the
///         maker accepts one (docs/adr/0007-open-offers.md).
/// @dev Design and rationale: docs/adr/0005-generic-asset-model.md, docs/adr/0007-open-offers.md
///      and docs/03-contract-design.md.
///      NFTs move with `transferFrom` only, and the contract has no `receive()`, no `fallback`
///      and no `IERC721Receiver`, so unsolicited transfers revert instead of getting stuck.
interface IOnDealV2 is IFeeAdmin {
    // ─────────────────────────────────────────────────────────────── Types

    enum Status {
        None,
        Open,
        Filled,
        Cancelled
    }

    enum AssetType {
        Native,
        ERC20,
        ERC721,
        ERC721Trait
    }

    /// @dev Field rules, enforced at creation:
    ///      Native: `token == 0`, `id == 0`, `amount > 0`.
    ///      ERC20:  `token` is a contract, `id == 0`, `amount > 0`.
    ///      ERC721: `token` is a contract, `amount == 1`.
    ///      ERC721Trait (requested side of `createTraitTrade` only): `token` is a contract, `id`
    ///      is the non-zero Merkle root of the token ids that satisfy the request, and `amount`
    ///      (1..`MAX_ASSETS_PER_SIDE`) is how many of them the taker hands over.
    struct Asset {
        AssetType assetType;
        address token;
        uint256 id;
        uint256 amount;
    }

    /// @notice What a taker supplies for one `ERC721Trait` asset: `tokenIds[i]` with
    ///         `proofs[i]`. Both arrays have exactly the asset's `amount` entries.
    struct TraitFill {
        uint256[] tokenIds;
        bytes32[][] proofs;
    }

    enum ProposalStatus {
        None,
        Active,
        Accepted,
        Withdrawn,
        Rejected
    }

    /// @notice A taker's answer to an open offer. `assets` sit in escrow while the proposal is
    ///         `Active` and never change after `propose`.
    struct Proposal {
        address proposer;
        ProposalStatus status;
        Asset[] assets;
    }

    /// @dev An *open offer* is a trade with an empty `requested` side. It can only be settled by
    ///      `acceptProposal`, never by `fillTrade`.
    struct Trade {
        address maker;
        /// @notice Unix timestamp after which the trade can't be filled. 0 = never expires.
        uint64 expiry;
        Status status;
        /// @notice Only this address may fill. address(0) = anyone.
        address taker;
        /// @notice What each side of this deal pays: the fee in force when it was created. The
        ///         taker or proposer sends this, not the current `fee()`.
        uint96 fee;
        /// @notice Escrowed by the maker at creation, paid to the taker on fill.
        Asset[] offered;
        /// @notice Paid by the taker at fill, straight to the maker.
        Asset[] requested;
    }

    // ─────────────────────────────────────────────────────────────── Events

    event TradeCreated(
        uint256 indexed tradeId,
        address indexed maker,
        address indexed taker,
        Asset[] offered,
        Asset[] requested,
        uint64 expiry
    );
    event TradeFilled(uint256 indexed tradeId, address indexed maker, address indexed taker);
    /// @notice The maker's description of the trait sets behind a trade's `ERC721Trait` assets.
    ///         Opaque to the contract: it proves only membership in each Merkle set, and clients
    ///         rebuild the sets from this text and compare roots before filling.
    event TraitSpec(uint256 indexed tradeId, string spec);
    /// @notice The maker's free-text hint on an open offer. Not binding.
    event OfferNote(uint256 indexed tradeId, string note);
    event ProposalCreated(
        uint256 indexed tradeId,
        uint256 indexed proposalId,
        address indexed proposer,
        Asset[] assets
    );
    event ProposalWithdrawn(uint256 indexed tradeId, uint256 indexed proposalId);
    event ProposalRejected(uint256 indexed tradeId, uint256 indexed proposalId);
    event ProposalAccepted(uint256 indexed tradeId, uint256 indexed proposalId);
    event TradeCancelled(uint256 indexed tradeId, address indexed maker);
    event TradeReclaimed(uint256 indexed tradeId, address indexed maker, address indexed caller);

    /// @notice A payout was rejected by the recipient or the token, and is held for `claim`.
    event AssetCredited(
        address indexed account,
        address indexed token,
        AssetType assetType,
        uint256 id,
        uint256 amount
    );
    event Claimed(
        address indexed account,
        address indexed token,
        AssetType assetType,
        uint256 id,
        uint256 amount
    );
    /// @notice A deal completed and both sides' fee shares (`amount` = 2 × the trade's `fee`) went to
    ///         `recipient`, or were credited to it for `claim` if it rejected the MON. Not
    ///         emitted when the fee is 0.
    event FeeCharged(uint256 indexed tradeId, address indexed recipient, uint256 amount);

    // ─────────────────────────────────────────────────────────────── Errors

    /// @notice A side has no assets.
    error EmptySide();
    error TooManyAssets(uint256 count, uint256 max);
    /// @notice Asset `index` (within its side) breaks the field rules on `Asset`.
    error InvalidAsset(uint256 index);
    /// @notice The same asset is listed twice on one side.
    error DuplicateAsset(uint256 index);
    /// @notice The same asset is on both sides, so the trade could never be filled.
    error SameAssetBothSides(uint256 offeredIndex, uint256 requestedIndex);
    error ExpiryInPast(uint64 expiry);
    /// @notice `msg.value` isn't exactly the native amount for this call plus the caller's share
    ///         of the protocol fee (`fee()` at create, the trade's `fee` after). `expected`
    ///         already includes the fee.
    error WrongNativeAmount(uint256 expected, uint256 sent);
    /// @notice The escrow received less than the maker offered (fee-on-transfer, rebasing or
    ///         otherwise non-standard token). Such tokens aren't supported.
    error UnsupportedToken(address token);
    /// @notice The contract does not own the NFT after the transfer.
    error NftNotReceived(address token, uint256 id);
    error TradeNotOpen(uint256 tradeId);
    error TradeIsExpired(uint256 tradeId);
    error TradeNotExpired(uint256 tradeId);
    error NotMaker(uint256 tradeId);
    error NotAllowedTaker(uint256 tradeId);
    error SelfFill(uint256 tradeId);
    /// @notice The note is longer than `MAX_NOTE_BYTES`.
    error NoteTooLong(uint256 length, uint256 max);
    /// @notice The trade has an ask, so it takes no proposals.
    error NotOpenOffer(uint256 tradeId);
    /// @notice The trade is an open offer, so `fillTrade` can't settle it.
    error OpenOfferNoFill(uint256 tradeId);
    error SelfPropose(uint256 tradeId);
    error UnknownProposal(uint256 tradeId, uint256 proposalId);
    error ProposalNotActive(uint256 tradeId, uint256 proposalId);
    error NotProposer(uint256 tradeId, uint256 proposalId);
    /// @notice `createTraitTrade` needs an `ERC721Trait` asset in `requested`.
    error NoTraitAsset();
    /// @notice The trait spec is empty or longer than `MAX_SPEC_BYTES`.
    error BadTraitSpec(uint256 length, uint256 max);
    /// @notice The trade has an `ERC721Trait` asset, so `fillTrade` can't settle it.
    error TraitFillRequired(uint256 tradeId);
    /// @notice `fills` doesn't match the trade's trait assets: wrong count, wrong number of ids
    ///         or proofs for one, or an id repeated within one.
    error InvalidTraitFill(uint256 fillIndex);
    /// @notice `tokenId` isn't in the Merkle set the trade asks for.
    error InvalidTraitProof(uint256 fillIndex, uint256 tokenId);
    error NothingToClaim();
    /// @notice The transfer during `claim` failed; the credit is kept.
    error ClaimFailed();

    // ─────────────────────────────────────────────────────────────── Mutating

    /// @notice Escrow `offered` and open a trade for `requested`. Send exactly the native
    ///         amount listed in `offered` plus `fee()` as `msg.value`. That share is held, and
    ///         refunded if the trade is cancelled or reclaimed. The trade records it as `fee`,
    ///         which is what the other side pays too.
    function createTrade(
        Asset[] calldata offered,
        Asset[] calldata requested,
        address taker,
        uint64 expiry
    ) external payable returns (uint256 tradeId);

    /// @notice Escrow `offered` and open a trade with no ask. Takers answer with `propose`.
    ///         `taker`, if set, is the only address that may propose. `note` (at most
    ///         `MAX_NOTE_BYTES`) tells proposers what the maker is after and binds nobody.
    function createOpenOffer(
        Asset[] calldata offered,
        address taker,
        uint64 expiry,
        string calldata note
    ) external payable returns (uint256 tradeId);

    /// @notice `createTrade` for a `requested` side that includes `ERC721Trait` assets. `spec`
    ///         (1..`MAX_SPEC_BYTES`) describes them for clients and is stored, so a deal can be
    ///         named without event history. `offered` and `taker` follow `createTrade`.
    function createTraitTrade(
        Asset[] calldata offered,
        Asset[] calldata requested,
        address taker,
        uint64 expiry,
        string calldata spec
    ) external payable returns (uint256 tradeId);

    /// @notice Escrow `assets` as a proposal on an open offer. Send exactly the native amount
    ///         listed in `assets` plus the trade's `fee` as `msg.value`. That share is held with
    ///         the proposal and refunded on withdraw or reject.
    function propose(uint256 tradeId, Asset[] calldata assets)
        external
        payable
        returns (uint256 proposalId);

    /// @notice Proposer takes an `Active` proposal back, at any time, whatever the trade's state.
    function withdrawProposal(uint256 tradeId, uint256 proposalId) external;

    /// @notice Maker sends an `Active` proposal back to its proposer, while the trade is open.
    function rejectProposal(uint256 tradeId, uint256 proposalId) external;

    /// @notice Maker settles the open offer with an `Active` proposal: the proposal's assets go
    ///         to the maker and the escrowed offer to the proposer. Other proposals stay
    ///         `Active` for their proposers to withdraw.
    ///         Both fee shares (the maker's and the proposer's, already held) go to
    ///         `FEE_RECIPIENT`.
    function acceptProposal(uint256 tradeId, uint256 proposalId) external;

    /// @notice Pay `requested` and receive `offered`. Send exactly the native amount listed in
    ///         `requested` plus the trade's `fee` as `msg.value`. Both sides' fee shares go to
    ///         `FEE_RECIPIENT`.
    function fillTrade(uint256 tradeId) external payable;

    /// @notice `fillTrade` for a trade with `ERC721Trait` assets: `fills[k]` answers the k-th
    ///         trait asset in `requested`. Also fills a trade with none, given no `fills`.
    function fillTraitTrade(uint256 tradeId, TraitFill[] calldata fills) external payable;

    /// @notice Maker takes the escrow back, at any time while the trade is open.
    function cancelTrade(uint256 tradeId) external;

    /// @notice Anyone returns an expired trade's escrow to its maker.
    function reclaimExpired(uint256 tradeId) external;

    /// @notice Collect a payout that was rejected earlier. Reverts with `ClaimFailed` if the
    ///         transfer fails again, and the credit stays.
    function claim(AssetType assetType, address token, uint256 id) external;

    // ─────────────────────────────────────────────────────────────── Views

    function MAX_ASSETS_PER_SIDE() external view returns (uint256);
    function MAX_NOTE_BYTES() external view returns (uint256);
    function MAX_SPEC_BYTES() external view returns (uint256);
    function tradeCount() external view returns (uint256);
    function getTrade(uint256 tradeId) external view returns (Trade memory);
    function isExpired(uint256 tradeId) external view returns (bool);
    function offerNote(uint256 tradeId) external view returns (string memory);
    function traitSpec(uint256 tradeId) external view returns (string memory);
    function proposalCount(uint256 tradeId) external view returns (uint256);
    function getProposal(uint256 tradeId, uint256 proposalId)
        external
        view
        returns (Proposal memory);
    /// @notice Proposals `offset .. offset + limit - 1`, clamped to what exists.
    function getProposals(uint256 tradeId, uint256 offset, uint256 limit)
        external
        view
        returns (Proposal[] memory);
    function claimable(address account, AssetType assetType, address token, uint256 id)
        external
        view
        returns (uint256);
}
