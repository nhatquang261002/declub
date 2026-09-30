// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Chog Swap V2: generic multi-asset OTC escrow
/// @notice The maker escrows up to `MAX_ASSETS_PER_SIDE` assets (native MON, ERC-20, ERC-721, in
///         any mix) and names up to as many assets in return. A taker fills the trade in one
///         transaction: the taker's assets go straight to the maker and the escrow goes to the
///         taker. Taker assets are never held by the contract (docs/adr/0001-atomic-fill.md).
/// @dev Design and rationale: docs/adr/0005-generic-asset-model.md and docs/03-contract-design.md.
///      NFTs move with `transferFrom` only, and the contract has no `receive()`, no `fallback`
///      and no `IERC721Receiver`, so unsolicited transfers revert instead of getting stuck.
interface IChogSwapV2 {
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
        ERC721
    }

    /// @dev Field rules, enforced at creation:
    ///      Native: `token == 0`, `id == 0`, `amount > 0`.
    ///      ERC20:  `token` is a contract, `id == 0`, `amount > 0`.
    ///      ERC721: `token` is a contract, `amount == 1`.
    struct Asset {
        AssetType assetType;
        address token;
        uint256 id;
        uint256 amount;
    }

    struct Trade {
        address maker;
        /// @notice Unix timestamp after which the trade can't be filled. 0 = never expires.
        uint64 expiry;
        Status status;
        /// @notice Only this address may fill. address(0) = anyone.
        address taker;
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
    /// @notice `msg.value` isn't exactly the native amount for this call.
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
    error NothingToClaim();
    /// @notice The transfer during `claim` failed; the credit is kept.
    error ClaimFailed();

    // ─────────────────────────────────────────────────────────────── Mutating

    /// @notice Escrow `offered` and open a trade for `requested`. Send exactly the native
    ///         amount listed in `offered` as `msg.value`.
    function createTrade(
        Asset[] calldata offered,
        Asset[] calldata requested,
        address taker,
        uint64 expiry
    ) external payable returns (uint256 tradeId);

    /// @notice Pay `requested` and receive `offered`. Send exactly the native amount listed in
    ///         `requested` as `msg.value`.
    function fillTrade(uint256 tradeId) external payable;

    /// @notice Maker takes the escrow back, at any time while the trade is open.
    function cancelTrade(uint256 tradeId) external;

    /// @notice Anyone returns an expired trade's escrow to its maker.
    function reclaimExpired(uint256 tradeId) external;

    /// @notice Collect a payout that was rejected earlier. Reverts with `ClaimFailed` if the
    ///         transfer fails again, and the credit stays.
    function claim(AssetType assetType, address token, uint256 id) external;

    // ─────────────────────────────────────────────────────────────── Views

    function MAX_ASSETS_PER_SIDE() external view returns (uint256);
    function tradeCount() external view returns (uint256);
    function getTrade(uint256 tradeId) external view returns (Trade memory);
    function isExpired(uint256 tradeId) external view returns (bool);
    function claimable(address account, AssetType assetType, address token, uint256 id)
        external
        view
        returns (uint256);
}
