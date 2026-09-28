// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Chog Swap — trustless OTC escrow for Chogs on Monad
/// @notice The maker locks Chogs (and optionally MON) in escrow when creating a trade.
///         A taker fills the trade in a single transaction: the taker's requested assets
///         go straight to the maker and the escrowed assets go to the taker.
///         Taker assets are never held by the contract. See docs/adr/0001-atomic-fill.md.
/// @dev v1 supports a single ERC-721 collection (`chog()`) plus native MON.
///      All NFT movements use `transferFrom`. The contract deliberately does NOT
///      implement IERC721Receiver and has no receive()/fallback, so unsolicited
///      `safeTransferFrom` calls and plain MON transfers revert instead of getting stuck.
interface IChogSwap {
    // ─────────────────────────────────────────────────────────────── Types

    /// @notice Lifecycle of a trade. Expiry is derived from `expiry`, not stored as a status.
    /// @dev `None` is the zero value, so unknown trade ids read as `None`.
    enum Status {
        None,
        Open,
        Filled,
        Cancelled
    }

    struct Trade {
        /// @notice Creator of the trade; owner of the escrowed assets until fill/refund.
        address maker;
        /// @notice Unix timestamp after which the trade can't be filled. 0 = never expires.
        uint64 expiry;
        Status status;
        /// @notice Only this address may fill. address(0) = anyone (public offer).
        address taker;
        /// @notice MON (wei) escrowed by the maker, paid to the taker on fill.
        uint256 offeredMon;
        /// @notice MON (wei) the taker must send with `fillTrade`, paid to the maker.
        uint256 requestedMon;
        /// @notice Chog token ids escrowed by the maker, sent to the taker on fill.
        uint256[] offeredIds;
        /// @notice Exact Chog token ids the taker must own; sent to the maker on fill.
        uint256[] requestedIds;
    }

    // ─────────────────────────────────────────────────────────────── Events

    event TradeCreated(
        uint256 indexed tradeId,
        address indexed maker,
        address indexed taker,
        uint256[] offeredIds,
        uint256 offeredMon,
        uint256[] requestedIds,
        uint256 requestedMon,
        uint64 expiry
    );

    event TradeFilled(uint256 indexed tradeId, address indexed maker, address indexed taker);

    /// @notice Maker cancelled; escrowed assets returned to the maker.
    event TradeCancelled(uint256 indexed tradeId, address indexed maker);

    /// @notice Anyone returned an expired trade's escrowed assets to the maker.
    ///         The trade's status becomes `Cancelled`.
    event TradeReclaimed(uint256 indexed tradeId, address indexed maker, address indexed caller);

    /// @notice A MON push payment failed and was credited for `withdraw()` instead.
    event WithdrawalCredited(address indexed account, uint256 amount);

    event Withdrawn(address indexed account, uint256 amount);

    // ─────────────────────────────────────────────────────────────── Errors

    /// @notice Neither Chogs nor MON on one side of the trade.
    error EmptySide();
    /// @notice Both sides carry MON; net it out into one side instead.
    error MonOnBothSides();
    /// @notice A side lists more token ids than `MAX_TOKENS_PER_SIDE`.
    error TooManyTokens(uint256 count, uint256 max);
    error ExpiryInPast(uint64 expiry);
    error TradeNotOpen(uint256 tradeId);
    error TradeIsExpired(uint256 tradeId);
    error TradeNotExpired(uint256 tradeId);
    error NotMaker(uint256 tradeId);
    error NotAllowedTaker(uint256 tradeId);
    error SelfFill(uint256 tradeId);
    error WrongMonAmount(uint256 expected, uint256 sent);
    error NothingToWithdraw();
    error WithdrawFailed();

    // ─────────────────────────────────────────────────────────────── Mutating

    /// @notice Create a trade and escrow the maker's side.
    /// @dev Pulls every `offeredIds` token from msg.sender via `transferFrom`
    ///      (requires `setApprovalForAll(chogSwap, true)` on the Chog contract).
    ///      `msg.value` becomes `offeredMon`.
    /// @param offeredIds   Chogs the maker gives.
    /// @param requestedIds Exact Chogs the maker wants.
    /// @param requestedMon MON (wei) the maker wants in addition to `requestedIds`.
    /// @param taker        Restrict filling to this address; address(0) for a public offer.
    /// @param expiry       Unix timestamp; 0 for no expiry. Must be in the future otherwise.
    /// @return tradeId     Sequential id, starting at 1.
    function createTrade(
        uint256[] calldata offeredIds,
        uint256[] calldata requestedIds,
        uint256 requestedMon,
        address taker,
        uint64 expiry
    ) external payable returns (uint256 tradeId);

    /// @notice Atomically settle an open trade.
    /// @dev Requires `msg.value == requestedMon`, the caller owns every `requestedIds`
    ///      token and has approved this contract. In one transaction:
    ///        requestedIds  caller  → maker
    ///        requestedMon  caller  → maker
    ///        offeredIds    escrow  → caller
    ///        offeredMon    escrow  → caller
    ///      Failed MON pushes are credited via `WithdrawalCredited`, never reverted.
    function fillTrade(uint256 tradeId) external payable;

    /// @notice Maker cancels an open trade (expired or not) and gets the escrow back.
    function cancelTrade(uint256 tradeId) external;

    /// @notice Anyone can return an expired, open trade's escrow to its maker.
    function reclaimExpired(uint256 tradeId) external;

    /// @notice Withdraw MON credited after a failed push payment.
    function withdraw() external;

    // ─────────────────────────────────────────────────────────────── Views

    /// @notice The Chog ERC-721 collection this deployment trades.
    function chog() external view returns (address);

    /// @notice Upper bound on token ids per side (bounds gas per fill).
    function MAX_TOKENS_PER_SIDE() external view returns (uint256);

    function tradeCount() external view returns (uint256);

    function getTrade(uint256 tradeId) external view returns (Trade memory);

    /// @notice True if the trade has a non-zero expiry and `block.timestamp > expiry`.
    function isExpired(uint256 tradeId) external view returns (bool);

    function pendingWithdrawal(address account) external view returns (uint256);
}
