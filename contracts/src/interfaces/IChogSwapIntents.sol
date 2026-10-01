// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Chog Swap Intents: settle signed swap intents, wallet to wallet
/// @notice A maker signs an `Intent` (what they give, what they want back at least) and keeps
///         their assets. Anyone may submit a *cycle* of intents that satisfy each other: every
///         intent's `give` is paid, in full, to the next intent's maker, and must cover that
///         maker's `want`. Two intents make a plain swap; up to `MAX_CYCLE` make a ring.
///         The contract never holds any asset.
/// @dev Design and rationale: docs/adr/0008-trade-intents.md and docs/adr/0009-ring-swaps.md.
///      `Asset` mirrors ChogSwapV2's struct and enum values so the frontend's asset editor can be
///      reused, but only `ERC20` and `ERC721` are valid here: native MON can't be pulled from a
///      wallet (use WMON) and trait sets are not supported yet.
interface IChogSwapIntents {
    // ─────────────────────────────────────────────────────────────── Types

    enum AssetType {
        Native,
        ERC20,
        ERC721
    }

    /// @dev Field rules, enforced on every intent in a settlement:
    ///      ERC20:  `token` is a contract, `id == 0`, `amount > 0`.
    ///      ERC721: `token` is a contract, `amount == 1`.
    ///      Native is rejected.
    struct Asset {
        AssetType assetType;
        address token;
        uint256 id;
        uint256 amount;
    }

    /// @notice What a maker signs.
    /// @dev `give` is paid in full and all-or-nothing. `want` is a floor: ERC-20 amounts are
    ///      minimums, NFTs are exact. Anything the previous party gives beyond `want` (extra
    ///      amount, extra assets) goes to the maker. `deadline` is required (non-zero).
    ///      `nonce` is unordered: bit `nonce & 0xff` of word `nonce >> 8`.
    struct Intent {
        address maker;
        Asset[] give;
        Asset[] want;
        uint64 deadline;
        uint256 nonce;
    }

    // ─────────────────────────────────────────────────────────────── Events

    /// @notice One per intent in a settled cycle. `recipient` received the maker's `give`.
    event IntentFilled(
        bytes32 indexed intentHash, address indexed maker, address indexed recipient, uint256 nonce
    );

    /// @notice A maker invalidated unordered nonces without settling them.
    event NoncesInvalidated(address indexed maker, uint256 word, uint256 mask);

    // ─────────────────────────────────────────────────────────────── Errors

    error BadCycleSize(uint256 size);
    error SignatureCountMismatch(uint256 intents, uint256 signatures);
    error InvalidMaker(uint256 intent);
    error InvalidDeadline(uint256 intent);
    error IntentExpired(uint256 intent);
    error EmptySide(uint256 intent, bool give);
    error TooManyAssets(uint256 intent, bool give, uint256 count);
    error InvalidAsset(uint256 intent, bool give, uint256 index);
    error DuplicateAsset(uint256 intent, bool give, uint256 index);
    error SameAssetBothSides(uint256 intent);
    error BadSignature(uint256 intent);
    error NonceUsed(address maker, uint256 nonce);
    error DuplicateMaker(uint256 intent);
    error WantNotMet(uint256 intent, uint256 wantIndex);
    /// @notice An ERC-20 delivered a different amount than it was asked to (fee-on-transfer,
    ///         rebasing, lying token).
    error UnsupportedToken(address token);
    error NftNotReceived(address token, uint256 id);

    // ─────────────────────────────────────────────────────────────── Actions

    /// @notice Settle a cycle of 2..`MAX_CYCLE` intents atomically. Anyone may call. Reverts if
    ///         anything about any intent or transfer is off, leaving everyone as they were.
    /// @param cycle `cycle[i].give` goes to `cycle[(i + 1) % n].maker`.
    /// @param signatures `signatures[i]` is `cycle[i].maker`'s EIP-712 signature (ECDSA, or
    ///        ERC-1271 for contract wallets).
    function settle(Intent[] calldata cycle, bytes[] calldata signatures) external;

    /// @notice Invalidate unordered nonces: sets `mask` in the bitmap word `word` for the caller.
    ///         Use it to be sure an already-published intent can never settle.
    function invalidateNonces(uint256 word, uint256 mask) external;

    // ─────────────────────────────────────────────────────────────── Views

    function MAX_CYCLE() external view returns (uint256);
    function MAX_ASSETS_PER_SIDE() external view returns (uint256);

    /// @notice The EIP-712 struct hash of an intent.
    function hashIntent(Intent calldata intent) external pure returns (bytes32);

    /// @notice The digest a maker signs: `keccak256("\x19\x01" ‖ domainSeparator ‖ structHash)`.
    function intentDigest(Intent calldata intent) external view returns (bytes32);

    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function isNonceUsed(address maker, uint256 nonce) external view returns (bool);
}
