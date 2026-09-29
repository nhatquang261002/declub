// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IChogSwap} from "./interfaces/IChogSwap.sol";

/// @title ChogSwap: trustless OTC escrow for Chogs on Monad
/// @notice See IChogSwap for the full behaviour spec and docs/03-contract-design.md for rationale.
/// @dev No admin, no fees, no upgradeability. Every mutating function is nonReentrant and
///      follows checks → effects → interactions. Deliberately has no IERC721Receiver and no
///      receive()/fallback, so assets can only enter through createTrade / fillTrade.
contract ChogSwap is IChogSwap, ReentrancyGuard {
    uint256 public constant MAX_TOKENS_PER_SIDE = 10;

    address public immutable chog;

    uint256 public tradeCount;
    mapping(address account => uint256 amount) public pendingWithdrawal;

    mapping(uint256 tradeId => Trade) internal _trades;
    mapping(uint256 tradeId => bytes32) public requestedRoot;
    mapping(uint256 tradeId => uint256) public requestedCount;

    /// @notice `chog_` has no code.
    error InvalidCollection(address chog_);

    // The code-length check also rejects address(0).
    // forge-lint: disable-next-line(missing-zero-check)
    constructor(address chog_) {
        if (chog_.code.length == 0) revert InvalidCollection(chog_);
        chog = chog_;
    }

    // ─────────────────────────────────────────────────────────────── Mutating

    /// @inheritdoc IChogSwap
    function createTrade(
        uint256[] calldata offeredIds,
        uint256[] calldata requestedIds,
        uint256 requestedMon,
        address taker,
        uint64 expiry
    ) external payable nonReentrant returns (uint256 tradeId) {
        if (offeredIds.length == 0 && msg.value == 0) revert EmptySide();
        if (requestedIds.length == 0 && requestedMon == 0) revert EmptySide();
        if (msg.value != 0 && requestedMon != 0) revert MonOnBothSides();
        if (offeredIds.length > MAX_TOKENS_PER_SIDE) {
            revert TooManyTokens(offeredIds.length, MAX_TOKENS_PER_SIDE);
        }
        if (requestedIds.length > MAX_TOKENS_PER_SIDE) {
            revert TooManyTokens(requestedIds.length, MAX_TOKENS_PER_SIDE);
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (expiry != 0 && expiry <= block.timestamp) revert ExpiryInPast(expiry);

        tradeId = ++tradeCount;
        Trade storage t = _trades[tradeId];
        t.maker = msg.sender;
        t.expiry = expiry;
        t.status = Status.Open;
        t.taker = taker;
        t.offeredMon = msg.value;
        t.requestedMon = requestedMon;
        t.offeredIds = offeredIds;
        t.requestedIds = requestedIds;

        emit TradeCreated(
            tradeId, msg.sender, taker, offeredIds, msg.value, requestedIds, requestedMon, expiry
        );

        // Reverts if the maker doesn't own an id, hasn't approved us, or lists an id twice.
        IERC721 nft = IERC721(chog);
        for (uint256 i; i < offeredIds.length; ++i) {
            // forge-lint: disable-next-line(calls-loop)
            nft.transferFrom(msg.sender, address(this), offeredIds[i]);
        }
    }

    /// @inheritdoc IChogSwap
    function createTrade(
        uint256[] calldata offeredIds,
        bytes32 root,
        uint8 count,
        uint256 requestedMon,
        address taker,
        uint64 expiry
    ) external payable nonReentrant returns (uint256 tradeId) {
        if (offeredIds.length == 0 && msg.value == 0) revert EmptySide();
        if (root == bytes32(0) || count == 0) revert InvalidTraitRequest();
        if (msg.value != 0 && requestedMon != 0) revert MonOnBothSides();
        if (offeredIds.length > MAX_TOKENS_PER_SIDE) {
            revert TooManyTokens(offeredIds.length, MAX_TOKENS_PER_SIDE);
        }
        if (count > MAX_TOKENS_PER_SIDE) revert TooManyTokens(count, MAX_TOKENS_PER_SIDE);
        // forge-lint: disable-next-line(block-timestamp)
        if (expiry != 0 && expiry <= block.timestamp) revert ExpiryInPast(expiry);

        tradeId = ++tradeCount;
        Trade storage t = _trades[tradeId];
        t.maker = msg.sender;
        t.expiry = expiry;
        t.status = Status.Open;
        t.taker = taker;
        t.offeredMon = msg.value;
        t.requestedMon = requestedMon;
        t.offeredIds = offeredIds;
        requestedRoot[tradeId] = root;
        requestedCount[tradeId] = count;

        emit TraitTradeCreated(
            tradeId, msg.sender, taker, offeredIds, msg.value, root, count, requestedMon, expiry
        );

        IERC721 nft = IERC721(chog);
        for (uint256 i; i < offeredIds.length; ++i) {
            // forge-lint: disable-next-line(calls-loop)
            nft.transferFrom(msg.sender, address(this), offeredIds[i]);
        }
    }

    /// @inheritdoc IChogSwap
    function fillTrade(uint256 tradeId) external payable nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != Status.Open) revert TradeNotOpen(tradeId);
        if (_isExpired(t)) revert TradeIsExpired(tradeId);
        address maker = t.maker;
        address taker = t.taker;
        if (taker != address(0) && msg.sender != taker) revert NotAllowedTaker(tradeId);
        if (msg.sender == maker) revert SelfFill(tradeId);
        if (msg.value != t.requestedMon) revert WrongMonAmount(t.requestedMon, msg.value);

        t.status = Status.Filled;
        emit TradeFilled(tradeId, maker, msg.sender);

        IERC721 nft = IERC721(chog);
        uint256[] storage requestedIds = t.requestedIds;
        for (uint256 i; i < requestedIds.length; ++i) {
            // forge-lint: disable-next-line(calls-loop)
            nft.transferFrom(msg.sender, maker, requestedIds[i]);
        }
        uint256[] storage offeredIds = t.offeredIds;
        for (uint256 i; i < offeredIds.length; ++i) {
            // forge-lint: disable-next-line(calls-loop)
            nft.transferFrom(address(this), msg.sender, offeredIds[i]);
        }
        _sendMon(maker, msg.value);
        _sendMon(msg.sender, t.offeredMon);
    }

    /// @inheritdoc IChogSwap
    function fillTrade(
        uint256 tradeId,
        uint256[] calldata requestedIds,
        bytes32[][] calldata proofs
    ) external payable nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != Status.Open) revert TradeNotOpen(tradeId);
        if (_isExpired(t)) revert TradeIsExpired(tradeId);
        bytes32 root = requestedRoot[tradeId];
        uint256 count = requestedCount[tradeId];
        if (root == bytes32(0) || requestedIds.length != count || proofs.length != count) {
            revert InvalidTraitRequest();
        }
        address maker = t.maker;
        address taker = t.taker;
        if (taker != address(0) && msg.sender != taker) revert NotAllowedTaker(tradeId);
        if (msg.sender == maker) revert SelfFill(tradeId);
        if (msg.value != t.requestedMon) revert WrongMonAmount(t.requestedMon, msg.value);

        // Check every proof before changing status or transferring any token. This also
        // gives callers a deterministic failure instead of a partial ERC-721 transfer.
        for (uint256 i; i < count; ++i) {
            if (!MerkleProof.verify(proofs[i], root, traitLeaf(requestedIds[i]))) {
                revert InvalidTraitProof(requestedIds[i]);
            }
            for (uint256 j; j < i; ++j) {
                if (requestedIds[j] == requestedIds[i]) revert InvalidTraitRequest();
            }
        }

        t.status = Status.Filled;
        emit TradeFilled(tradeId, maker, msg.sender);
        IERC721 nft = IERC721(chog);
        for (uint256 i; i < count; ++i) {
            // forge-lint: disable-next-line(calls-loop)
            nft.transferFrom(msg.sender, maker, requestedIds[i]);
        }
        uint256[] storage offeredIds = t.offeredIds;
        for (uint256 i; i < offeredIds.length; ++i) {
            // forge-lint: disable-next-line(calls-loop)
            nft.transferFrom(address(this), msg.sender, offeredIds[i]);
        }
        _sendMon(maker, msg.value);
        _sendMon(msg.sender, t.offeredMon);
    }

    /// @inheritdoc IChogSwap
    function cancelTrade(uint256 tradeId) external nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != Status.Open) revert TradeNotOpen(tradeId);
        if (msg.sender != t.maker) revert NotMaker(tradeId);

        t.status = Status.Cancelled;
        emit TradeCancelled(tradeId, t.maker);

        _refund(t);
    }

    /// @inheritdoc IChogSwap
    function reclaimExpired(uint256 tradeId) external nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != Status.Open) revert TradeNotOpen(tradeId);
        if (!_isExpired(t)) revert TradeNotExpired(tradeId);

        t.status = Status.Cancelled;
        emit TradeReclaimed(tradeId, t.maker, msg.sender);

        _refund(t);
    }

    /// @inheritdoc IChogSwap
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawal[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawal[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
    }

    // ─────────────────────────────────────────────────────────────── Views

    /// @inheritdoc IChogSwap
    function getTrade(uint256 tradeId) external view returns (Trade memory) {
        return _trades[tradeId];
    }

    /// @inheritdoc IChogSwap
    function isExpired(uint256 tradeId) external view returns (bool) {
        return _isExpired(_trades[tradeId]);
    }

    function traitLeaf(uint256 tokenId) public view returns (bytes32) {
        return keccak256(abi.encode(chog, tokenId));
    }

    // ─────────────────────────────────────────────────────────────── Internals

    function _isExpired(Trade storage t) private view returns (bool) {
        uint64 expiry = t.expiry;
        // Second-level validator skew is irrelevant for trade expiries measured in hours.
        // forge-lint: disable-next-line(block-timestamp)
        return expiry != 0 && block.timestamp > expiry;
    }

    /// @dev Returns the escrowed side to the maker. Caller must have closed the trade first.
    function _refund(Trade storage t) private {
        address maker = t.maker;
        IERC721 nft = IERC721(chog);
        uint256[] storage offeredIds = t.offeredIds;
        for (uint256 i; i < offeredIds.length; ++i) {
            // forge-lint: disable-next-line(calls-loop)
            nft.transferFrom(address(this), maker, offeredIds[i]);
        }
        _sendMon(maker, t.offeredMon);
    }

    /// @dev Never reverts: a recipient that rejects MON is credited for `withdraw()` instead,
    ///      so it can't block a fill, cancel or reclaim.
    function _sendMon(address to, uint256 amount) private {
        if (amount == 0) return;
        // Recipients are always the trade's own maker/taker. Crediting after a *failed* send
        // is reentrancy-safe: nothing was paid out, and every entry point is nonReentrant.
        // forge-lint: disable-next-item(arbitrary-send-eth, reentrancy-eth)
        (bool ok,) = to.call{value: amount}("");
        if (!ok) {
            pendingWithdrawal[to] += amount;
            // Only known after the (failed) call; nonReentrant rules out log fabrication.
            // forge-lint: disable-next-line(reentrancy-events)
            emit WithdrawalCredited(to, amount);
        }
    }
}
