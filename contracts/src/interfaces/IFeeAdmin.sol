// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DeClub fee admin: the one thing about a deployed contract that can change
/// @notice The protocol fee amount. A fee admin can lower it at once or queue a raise that waits
///         `FEE_RAISE_DELAY`, never above `MAX_FEE`, and can hand the role on or renounce it. The
///         recipient, the ceiling and (for intents) the fee token are fixed at deploy, and the
///         admin can't touch anything else: no escrow, no credits, no nonces, no pause.
/// @dev Design and rationale: docs/adr/0018-adjustable-protocol-fee.md. The admin is a Safe kept
///      apart from the recipient's. A zero admin, at deploy or after `renounceFeeAdmin`, fixes
///      the fee for good.
interface IFeeAdmin {
    // ─────────────────────────────────────────────────────────────── Events

    /// @notice A raise to `newFee` was queued and can be applied from `effectiveAt`. A newer
    ///         `setFee` replaces it.
    event FeeChangeQueued(uint256 newFee, uint256 effectiveAt);
    /// @notice The fee in force changed. A cut also drops any queued raise.
    event FeeChanged(uint256 oldFee, uint256 newFee);
    /// @notice `next` may now accept the role with `acceptFeeAdmin`. A zero `next` cancels.
    event FeeAdminTransferStarted(address indexed current, address indexed next);
    /// @notice The role moved. A zero `next` means it was renounced.
    event FeeAdminTransferred(address indexed previous, address indexed next);

    // ─────────────────────────────────────────────────────────────── Errors

    /// @notice A fee (or, in the constructor, the ceiling) is above `max`.
    error FeeTooHigh(uint256 fee, uint256 max);
    /// @notice The ceiling is not 0 but the recipient is the zero address.
    error NoFeeRecipient();
    error NotFeeAdmin(address caller);
    error NotPendingFeeAdmin(address caller);
    error NoPendingFee();
    /// @notice The queued raise can't be applied before `effectiveAt`.
    error FeeRaiseNotReady(uint256 effectiveAt);
    /// @notice The queued raise wasn't applied within `FEE_APPLY_WINDOW` of `effectiveAt`; queue
    ///         it again so users get fresh notice.
    error FeeRaiseExpired(uint256 effectiveAt);

    // ─────────────────────────────────────────────────────────────── Admin

    /// @notice Lower the fee (or keep it), at once, dropping any queued raise. Or, for a higher
    ///         `newFee`, queue it for `FEE_RAISE_DELAY` from now, replacing any queued raise.
    ///         `setFee(fee())` cancels a queued raise.
    function setFee(uint256 newFee) external;

    /// @notice Make the queued raise the fee in force, once its time has come and within
    ///         `FEE_APPLY_WINDOW` after it.
    function applyFee() external;

    /// @notice First step of handing the role to `next`, who must call `acceptFeeAdmin`. A zero
    ///         `next` cancels a handover in progress.
    function transferFeeAdmin(address next) external;

    function acceptFeeAdmin() external;

    /// @notice Give the role up for good: the fee in force never changes again, and any queued
    ///         raise or handover is dropped.
    function renounceFeeAdmin() external;

    // ─────────────────────────────────────────────────────────────── Views

    /// @notice What each side pays when a deal completes, for deals from now on.
    function fee() external view returns (uint256);
    /// @notice The queued raise, or 0.
    function pendingFee() external view returns (uint256);
    /// @notice When the queued raise can be applied, or 0.
    function pendingFeeAt() external view returns (uint256);
    function feeAdmin() external view returns (address);
    function pendingFeeAdmin() external view returns (address);
    /// @notice The ceiling for the fee. Fixed at deploy.
    function MAX_FEE() external view returns (uint256);
    /// @notice The ceiling for `MAX_FEE`, so a unit typo at deploy can't set an absurd one.
    function MAX_FEE_LIMIT() external view returns (uint256);
    function FEE_RAISE_DELAY() external view returns (uint256);
    /// @notice Where the fees go. Fixed at deploy.
    function FEE_RECIPIENT() external view returns (address);
}
