// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDeClubRewards} from "./interfaces/IDeClubRewards.sol";

/// @title DeClubRewards: Club payouts per epoch, claimed against a Merkle root
/// @notice See IDeClubRewards for the behaviour spec and docs/adr/0022-club-rewards.md for the
///         reasoning.
/// @dev No upgradeability and no token: rewards are MON. The operator publishes, revokes and
///      sweeps; it can't touch an epoch's MON once claims are open, except what's left after
///      `CLAIM_WINDOW`. Every epoch keeps its own books, so a wrong root can only ever pay out
///      that epoch's own funding.
contract DeClubRewards is IDeClubRewards, ReentrancyGuard {
    uint256 public constant MAX_CLAIM_DELAY = 7 days;
    uint256 public constant MIN_CLAIM_WINDOW = 1 days;
    uint256 public constant MAX_CLAIM_WINDOW = 365 days;

    uint256 public immutable CLAIM_DELAY;
    uint256 public immutable CLAIM_WINDOW;

    address public operator;
    address public pendingOperator;

    mapping(uint64 epoch => Epoch) private _epochs;
    mapping(uint64 epoch => mapping(address account => bool)) private _claimed;

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator(msg.sender);
        _;
    }

    /// @param initialOperator Publishes, revokes and sweeps epochs.
    /// @param claimDelay How long a root waits before claims open; 0 opens them at once.
    /// @param claimWindow How long claims stay open before the rest can be swept.
    constructor(address initialOperator, uint256 claimDelay, uint256 claimWindow) {
        if (initialOperator == address(0)) revert NoOperator();
        if (
            claimDelay > MAX_CLAIM_DELAY || claimWindow < MIN_CLAIM_WINDOW
                || claimWindow > MAX_CLAIM_WINDOW
        ) revert BadTiming(claimDelay, claimWindow);
        operator = initialOperator;
        CLAIM_DELAY = claimDelay;
        CLAIM_WINDOW = claimWindow;
        emit OperatorTransferred(address(0), initialOperator);
    }

    // ─────────────────────────────────────────────────────────────── Operator

    /// @inheritdoc IDeClubRewards
    function publish(uint64 epoch, bytes32 root) external payable onlyOperator {
        if (_epochs[epoch].root != bytes32(0)) revert EpochExists(epoch);
        if (root == bytes32(0)) revert EmptyRoot();
        if (msg.value == 0) revert NothingFunded();
        uint256 openAt = block.timestamp + CLAIM_DELAY;
        // Both fit: no one can send 2^128 wei, and a timestamp fits 64 bits.
        // forge-lint: disable-next-line(unsafe-typecast)
        _epochs[epoch] = Epoch(root, uint128(msg.value), 0, uint64(openAt), false);
        emit EpochPublished(epoch, root, msg.value, openAt);
    }

    /// @inheritdoc IDeClubRewards
    function revoke(uint64 epoch) external nonReentrant onlyOperator {
        Epoch memory e = _published(epoch);
        // Nothing can be claimed before `openAt`, so a revoked epoch always refunds in full.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= e.openAt) revert RevokeTooLate(epoch);
        delete _epochs[epoch];
        emit EpochRevoked(epoch, e.total);
        _send(msg.sender, e.total);
    }

    /// @inheritdoc IDeClubRewards
    function sweep(uint64 epoch) external nonReentrant onlyOperator {
        Epoch storage e = _epochs[epoch];
        if (e.root == bytes32(0)) revert UnknownEpoch(epoch);
        if (e.closed) revert EpochClosed(epoch);
        uint256 at = uint256(e.openAt) + CLAIM_WINDOW;
        // Days-long windows: validator skew doesn't matter.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < at) revert SweepTooEarly(epoch, at);
        uint256 rest = uint256(e.total) - e.claimed;
        e.closed = true;
        emit EpochSwept(epoch, msg.sender, rest);
        if (rest != 0) _send(msg.sender, rest);
    }

    /// @inheritdoc IDeClubRewards
    // A zero `next` cancels a handover, and `OperatorTransferStarted` records it.
    // forge-lint: disable-next-item(missing-zero-check, missing-events-access-control)
    function transferOperator(address next) external onlyOperator {
        pendingOperator = next;
        emit OperatorTransferStarted(msg.sender, next);
    }

    /// @inheritdoc IDeClubRewards
    // `OperatorTransferred` records the handover, which also clears the pending role.
    // forge-lint: disable-next-item(missing-events-access-control)
    function acceptOperator() external {
        if (msg.sender != pendingOperator || msg.sender == address(0)) {
            revert NotPendingOperator(msg.sender);
        }
        address previous = operator;
        operator = msg.sender;
        pendingOperator = address(0);
        emit OperatorTransferred(previous, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────── Claims

    /// @inheritdoc IDeClubRewards
    function claim(uint64 epoch, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
    {
        _claim(epoch, account, amount, proof);
    }

    /// @inheritdoc IDeClubRewards
    function claimMany(Claim[] calldata claims) external nonReentrant {
        for (uint256 i; i < claims.length; ++i) {
            Claim calldata c = claims[i];
            _claim(c.epoch, c.account, c.amount, c.proof);
        }
    }

    // ─────────────────────────────────────────────────────────────── Views

    /// @inheritdoc IDeClubRewards
    function epochs(uint64 epoch) external view returns (Epoch memory) {
        return _epochs[epoch];
    }

    /// @inheritdoc IDeClubRewards
    function isClaimed(uint64 epoch, address account) external view returns (bool) {
        return _claimed[epoch][account];
    }

    /// @inheritdoc IDeClubRewards
    function leaf(uint64 epoch, address account, uint256 amount) public view returns (bytes32) {
        return keccak256(
            bytes.concat(keccak256(abi.encode(block.chainid, address(this), epoch, account, amount)))
        );
    }

    // ─────────────────────────────────────────────────────────────── Internals

    // `claimMany` is all or nothing, so a revert inside its loop is intended. Both entry points
    // are `nonReentrant`, and the state is written before the send, so an event can't be reordered.
    // forge-lint: disable-next-item(require-revert-in-loop, reentrancy-events)
    function _claim(uint64 epoch, address account, uint256 amount, bytes32[] calldata proof)
        private
    {
        if (account == address(0)) revert ZeroAccount();
        Epoch storage e = _epochs[epoch];
        if (e.root == bytes32(0)) revert UnknownEpoch(epoch);
        if (e.closed) revert EpochClosed(epoch);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < e.openAt) revert NotOpenYet(epoch, e.openAt);
        if (_claimed[epoch][account]) revert AlreadyClaimed(epoch, account);
        if (!MerkleProof.verifyCalldata(proof, e.root, leaf(epoch, account, amount))) {
            revert InvalidProof(epoch, account, amount);
        }
        uint256 claimed = uint256(e.claimed) + amount;
        if (claimed > e.total) revert OverClaim(epoch, claimed, e.total);

        _claimed[epoch][account] = true;
        // Fits: at most `total`, a uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        e.claimed = uint128(claimed);
        emit RewardClaimed(epoch, account, amount);
        _send(account, amount);
    }

    function _published(uint64 epoch) private view returns (Epoch memory e) {
        e = _epochs[epoch];
        if (e.root == bytes32(0)) revert UnknownEpoch(epoch);
    }

    /// @dev Reverts if `to` refuses: a claim is retried later, and nothing else is at stake. `to`
    ///      is the leaf's own account or the operator, never chosen by the caller.
    // forge-lint: disable-next-item(arbitrary-send-eth, calls-loop, require-revert-in-loop)
    function _send(address to, uint256 amount) private {
        // forge-lint: disable-next-line(low-level-calls)
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert PayoutFailed(to);
    }
}
