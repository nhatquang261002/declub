// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DeClub Rewards: each epoch's Club payouts, claimed against a Merkle root
/// @notice Every epoch the operator publishes one Merkle root and sends the MON it covers. Each
///         leaf is one account's total for that epoch: its Holder share in every Club it holds,
///         plus the Club fund of any Club it owns. Anyone can claim a leaf for its account, once.
///         A root waits `CLAIM_DELAY` before claims open, and in that time the operator can revoke
///         it and take the MON back. After `CLAIM_WINDOW` the operator can sweep what's
///         unclaimed, to roll it into a later epoch.
/// @dev Design and rationale: docs/adr/0022-club-rewards.md. A leaf is
///      `keccak256(bytes.concat(keccak256(abi.encode(chainid, rewards, epoch, account, amount))))`
///      in a sorted-pair tree (OpenZeppelin `MerkleProof`). Hashing twice keeps a leaf from ever
///      being mistaken for an inner node, and the chain id and contract address keep a proof from
///      being replayed against another deployment. The contract can't check that a root matches
///      what the epoch's published data says; it only guarantees that one epoch never pays out
///      more than it was funded with, and that no leaf is paid twice.
interface IDeClubRewards {
    /// @notice One published epoch. `claimed` counts up to `total`; a swept or revoked epoch has
    ///         `closed` set (revoked ones are deleted instead, so they can be published again).
    struct Epoch {
        bytes32 root;
        uint128 total;
        uint128 claimed;
        uint64 openAt;
        bool closed;
    }

    /// @notice One leaf to claim with `claimMany`.
    struct Claim {
        uint64 epoch;
        address account;
        uint256 amount;
        bytes32[] proof;
    }

    // ─────────────────────────────────────────────────────────────── Events

    event EpochPublished(uint64 indexed epoch, bytes32 root, uint256 total, uint256 openAt);
    /// @notice The operator took an epoch back before its claims opened. It can be published again.
    event EpochRevoked(uint64 indexed epoch, uint256 refund);
    event RewardClaimed(uint64 indexed epoch, address indexed account, uint256 amount);
    /// @notice What was left unclaimed after `CLAIM_WINDOW` went back to the operator.
    event EpochSwept(uint64 indexed epoch, address indexed to, uint256 amount);
    /// @notice `next` may now accept the role with `acceptOperator`. A zero `next` cancels.
    event OperatorTransferStarted(address indexed current, address indexed next);
    event OperatorTransferred(address indexed previous, address indexed next);

    // ─────────────────────────────────────────────────────────────── Errors

    error NotOperator(address caller);
    error NotPendingOperator(address caller);
    /// @notice The constructor's operator is the zero address.
    error NoOperator();
    /// @notice The constructor's delay is over `MAX_CLAIM_DELAY`, or its window is outside
    ///         `[MIN_CLAIM_WINDOW, MAX_CLAIM_WINDOW]`.
    error BadTiming(uint256 claimDelay, uint256 claimWindow);
    error EpochExists(uint64 epoch);
    error EmptyRoot();
    error NothingFunded();
    error UnknownEpoch(uint64 epoch);
    /// @notice Claims for the epoch open at `openAt`.
    error NotOpenYet(uint64 epoch, uint256 openAt);
    /// @notice The epoch was swept; its unclaimed leaves can't be paid any more.
    error EpochClosed(uint64 epoch);
    error AlreadyClaimed(uint64 epoch, address account);
    error InvalidProof(uint64 epoch, address account, uint256 amount);
    /// @notice Paying this leaf would take the epoch past what it was funded with: the root is
    ///         wrong. The other leaves' MON stays safe.
    error OverClaim(uint64 epoch, uint256 claimed, uint256 total);
    /// @notice Claims have opened, so the epoch can no longer be revoked.
    error RevokeTooLate(uint64 epoch);
    /// @notice The epoch can't be swept before `at`.
    error SweepTooEarly(uint64 epoch, uint256 at);
    /// @notice The account, or the operator on a sweep or revoke, didn't accept the MON.
    error PayoutFailed(address to);
    error ZeroAccount();

    // ─────────────────────────────────────────────────────────────── Operator

    /// @notice Publish `epoch`'s root, funded with `msg.value`. Claims open after `CLAIM_DELAY`.
    function publish(uint64 epoch, bytes32 root) external payable;

    /// @notice Take back an epoch whose claims haven't opened yet, with its MON, so a wrong root
    ///         can be fixed and published again.
    function revoke(uint64 epoch) external;

    /// @notice Send what's unclaimed of an epoch to the operator, `CLAIM_WINDOW` after its claims
    ///         opened, and close it.
    function sweep(uint64 epoch) external;

    /// @notice First step of handing the role to `next`, who must call `acceptOperator`. A zero
    ///         `next` cancels a handover in progress.
    function transferOperator(address next) external;

    function acceptOperator() external;

    // ─────────────────────────────────────────────────────────────── Claims

    /// @notice Pay `amount` MON to `account` for `epoch`, if the proof shows that leaf. Anyone may
    ///         call it; the MON always goes to `account`.
    function claim(uint64 epoch, address account, uint256 amount, bytes32[] calldata proof) external;

    /// @notice `claim` for several leaves in one transaction. Reverts as a whole if any fails.
    function claimMany(Claim[] calldata claims) external;

    // ─────────────────────────────────────────────────────────────── Views

    function epochs(uint64 epoch) external view returns (Epoch memory);
    function isClaimed(uint64 epoch, address account) external view returns (bool);
    /// @notice The leaf the tree must hold for `account` to claim `amount` in `epoch`.
    function leaf(uint64 epoch, address account, uint256 amount) external view returns (bytes32);
    function operator() external view returns (address);
    function pendingOperator() external view returns (address);
    /// @notice How long a published root waits before claims open. Fixed at deploy.
    function CLAIM_DELAY() external view returns (uint256);
    /// @notice How long after its claims open an epoch can be swept. Fixed at deploy.
    function CLAIM_WINDOW() external view returns (uint256);
    function MAX_CLAIM_DELAY() external view returns (uint256);
    function MIN_CLAIM_WINDOW() external view returns (uint256);
    function MAX_CLAIM_WINDOW() external view returns (uint256);
}
