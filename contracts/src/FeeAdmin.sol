// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFeeAdmin} from "./interfaces/IFeeAdmin.sol";

/// @title FeeAdmin: the protocol fee amount, adjustable within a ceiling fixed at deploy
/// @notice See IFeeAdmin and docs/adr/0018-adjustable-protocol-fee.md.
/// @dev Shared by DeClubEscrow and DeClubIntents. No external calls, so nothing here needs a
///      reentrancy guard. A queued raise is always above the fee in force: a cut drops it, and
///      nothing else changes the fee while it waits.
abstract contract FeeAdmin is IFeeAdmin {
    uint256 public constant MAX_FEE_LIMIT = 500 ether;
    uint256 public constant FEE_RAISE_DELAY = 7 days;
    /// @dev How long a raise stays appliable once ready, so an old notice can't be used months on.
    uint256 public constant FEE_APPLY_WINDOW = 7 days;

    uint256 public immutable MAX_FEE;
    address public immutable FEE_RECIPIENT;

    address public feeAdmin;
    address public pendingFeeAdmin;

    // One slot. `MAX_FEE_LIMIT` fits a uint96 with room to spare.
    uint96 internal _fee;
    uint96 private _pendingFee;
    uint64 private _pendingFeeAt;

    modifier onlyFeeAdmin() {
        if (msg.sender != feeAdmin) revert NotFeeAdmin(msg.sender);
        _;
    }

    /// @param initialFee The fee in force at deploy. 0 charges nothing (tests, testnet).
    /// @param maxFee Ceiling for the fee, at most `MAX_FEE_LIMIT`.
    /// @param feeRecipient Receives the fees. Required when `maxFee` is not 0.
    /// @param admin May change the fee. Zero fixes it at `initialFee` for good.
    // A zero admin is a fixed fee, and a zero recipient is checked against the ceiling below.
    // forge-lint: disable-next-item(missing-zero-check)
    constructor(uint256 initialFee, uint256 maxFee, address feeRecipient, address admin) {
        if (maxFee > MAX_FEE_LIMIT) revert FeeTooHigh(maxFee, MAX_FEE_LIMIT);
        if (initialFee > maxFee) revert FeeTooHigh(initialFee, maxFee);
        if (maxFee != 0 && feeRecipient == address(0)) revert NoFeeRecipient();
        MAX_FEE = maxFee;
        FEE_RECIPIENT = feeRecipient;
        feeAdmin = admin;
        // forge-lint: disable-next-line(unsafe-typecast)
        _fee = uint96(initialFee);
        if (admin != address(0)) emit FeeAdminTransferred(address(0), admin);
    }

    // ─────────────────────────────────────────────────────────────── Admin

    /// @inheritdoc IFeeAdmin
    function setFee(uint256 newFee) external onlyFeeAdmin {
        if (newFee > MAX_FEE) revert FeeTooHigh(newFee, MAX_FEE);
        uint256 current = _fee;
        if (newFee <= current) {
            _clearPendingFee();
            _setFee(current, newFee);
        } else {
            uint256 effectiveAt = block.timestamp + FEE_RAISE_DELAY;
            // Both fit: `newFee` is at most `MAX_FEE`, and a timestamp fits 64 bits.
            // forge-lint: disable-next-line(unsafe-typecast)
            _pendingFee = uint96(newFee);
            // forge-lint: disable-next-line(unsafe-typecast)
            _pendingFeeAt = uint64(effectiveAt);
            emit FeeChangeQueued(newFee, effectiveAt);
        }
    }

    /// @inheritdoc IFeeAdmin
    function applyFee() external onlyFeeAdmin {
        uint256 effectiveAt = _pendingFeeAt;
        if (effectiveAt == 0) revert NoPendingFee();
        // Seconds of validator skew are irrelevant against a 7-day delay.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < effectiveAt) revert FeeRaiseNotReady(effectiveAt);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > effectiveAt + FEE_APPLY_WINDOW) revert FeeRaiseExpired(effectiveAt);
        uint256 newFee = _pendingFee;
        _clearPendingFee();
        _setFee(_fee, newFee);
    }

    /// @inheritdoc IFeeAdmin
    // A zero `next` cancels a handover.
    // forge-lint: disable-next-item(missing-zero-check)
    function transferFeeAdmin(address next) external onlyFeeAdmin {
        pendingFeeAdmin = next;
        emit FeeAdminTransferStarted(msg.sender, next);
    }

    /// @inheritdoc IFeeAdmin
    function acceptFeeAdmin() external {
        if (msg.sender != pendingFeeAdmin || msg.sender == address(0)) {
            revert NotPendingFeeAdmin(msg.sender);
        }
        address previous = feeAdmin;
        feeAdmin = msg.sender;
        pendingFeeAdmin = address(0);
        emit FeeAdminTransferred(previous, msg.sender);
    }

    /// @inheritdoc IFeeAdmin
    function renounceFeeAdmin() external onlyFeeAdmin {
        feeAdmin = address(0);
        pendingFeeAdmin = address(0);
        _clearPendingFee();
        emit FeeAdminTransferred(msg.sender, address(0));
    }

    // ─────────────────────────────────────────────────────────────── Views

    /// @inheritdoc IFeeAdmin
    function fee() external view returns (uint256) {
        return _fee;
    }

    /// @inheritdoc IFeeAdmin
    function pendingFee() external view returns (uint256) {
        return _pendingFee;
    }

    /// @inheritdoc IFeeAdmin
    function pendingFeeAt() external view returns (uint256) {
        return _pendingFeeAt;
    }

    // ─────────────────────────────────────────────────────────────── Internals

    function _setFee(uint256 oldFee, uint256 newFee) private {
        // forge-lint: disable-next-line(unsafe-typecast)
        _fee = uint96(newFee);
        emit FeeChanged(oldFee, newFee);
    }

    function _clearPendingFee() private {
        _pendingFee = 0;
        _pendingFeeAt = 0;
    }
}
