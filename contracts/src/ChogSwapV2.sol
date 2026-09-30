// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IChogSwapV2} from "./interfaces/IChogSwapV2.sol";

/// @title ChogSwapV2: generic multi-asset OTC escrow
/// @notice See IChogSwapV2 for the behaviour spec and docs/adr/0005-generic-asset-model.md for
///         the reasoning.
/// @dev No admin, no fees, no upgradeability, no token allowlist. Every mutating function is
///      nonReentrant and follows checks → effects → interactions. Payouts out of escrow never
///      revert: a recipient or token that rejects one gets a credit to `claim` instead.
///      Moving the *taker's* assets to the maker does revert on failure, so a fill is atomic.
contract ChogSwapV2 is IChogSwapV2, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_ASSETS_PER_SIDE = 10;

    uint256 public tradeCount;

    mapping(uint256 tradeId => Trade) internal _trades;
    /// @dev account → keccak256(assetType, token, id) → amount. Native and ERC-20 amounts add
    ///      up; an NFT credit is 1.
    mapping(address account => mapping(bytes32 assetKey => uint256 amount)) internal _credits;

    // ─────────────────────────────────────────────────────────────── Mutating

    /// @inheritdoc IChogSwapV2
    function createTrade(
        Asset[] calldata offered,
        Asset[] calldata requested,
        address taker,
        uint64 expiry
    ) external payable nonReentrant returns (uint256 tradeId) {
        uint256 offeredNative = _validateSide(offered);
        _validateSide(requested);
        _validateNoOverlap(offered, requested);
        if (msg.value != offeredNative) revert WrongNativeAmount(offeredNative, msg.value);
        // forge-lint: disable-next-line(block-timestamp)
        if (expiry != 0 && expiry <= block.timestamp) revert ExpiryInPast(expiry);

        tradeId = ++tradeCount;
        Trade storage t = _trades[tradeId];
        t.maker = msg.sender;
        t.expiry = expiry;
        t.status = Status.Open;
        t.taker = taker;
        for (uint256 i; i < offered.length; ++i) {
            t.offered.push(offered[i]);
        }
        for (uint256 i; i < requested.length; ++i) {
            t.requested.push(requested[i]);
        }

        emit TradeCreated(tradeId, msg.sender, taker, offered, requested, expiry);

        for (uint256 i; i < offered.length; ++i) {
            _deposit(offered[i]);
        }
    }

    /// @inheritdoc IChogSwapV2
    function fillTrade(uint256 tradeId) external payable nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != Status.Open) revert TradeNotOpen(tradeId);
        if (_isExpired(t)) revert TradeIsExpired(tradeId);
        address maker = t.maker;
        address taker = t.taker;
        if (taker != address(0) && msg.sender != taker) revert NotAllowedTaker(tradeId);
        if (msg.sender == maker) revert SelfFill(tradeId);
        uint256 requestedNative = _nativeAmount(t.requested);
        if (msg.value != requestedNative) revert WrongNativeAmount(requestedNative, msg.value);

        t.status = Status.Filled;
        emit TradeFilled(tradeId, maker, msg.sender);

        // The taker's side goes straight to the maker. A failing transfer reverts the fill.
        Asset[] storage requested = t.requested;
        for (uint256 i; i < requested.length; ++i) {
            Asset storage a = requested[i];
            if (a.assetType == AssetType.Native) {
                _payout(maker, a);
            } else if (a.assetType == AssetType.ERC20) {
                // forge-lint: disable-next-line(calls-loop)
                IERC20(a.token).safeTransferFrom(msg.sender, maker, a.amount);
            } else {
                // forge-lint: disable-next-line(calls-loop)
                IERC721(a.token).transferFrom(msg.sender, maker, a.id);
            }
        }
        _payoutAll(t.offered, msg.sender);
    }

    /// @inheritdoc IChogSwapV2
    function cancelTrade(uint256 tradeId) external nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != Status.Open) revert TradeNotOpen(tradeId);
        if (msg.sender != t.maker) revert NotMaker(tradeId);

        t.status = Status.Cancelled;
        emit TradeCancelled(tradeId, t.maker);

        _payoutAll(t.offered, t.maker);
    }

    /// @inheritdoc IChogSwapV2
    function reclaimExpired(uint256 tradeId) external nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != Status.Open) revert TradeNotOpen(tradeId);
        if (!_isExpired(t)) revert TradeNotExpired(tradeId);

        t.status = Status.Cancelled;
        emit TradeReclaimed(tradeId, t.maker, msg.sender);

        _payoutAll(t.offered, t.maker);
    }

    /// @inheritdoc IChogSwapV2
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

    /// @inheritdoc IChogSwapV2
    function getTrade(uint256 tradeId) external view returns (Trade memory) {
        return _trades[tradeId];
    }

    /// @inheritdoc IChogSwapV2
    function isExpired(uint256 tradeId) external view returns (bool) {
        return _isExpired(_trades[tradeId]);
    }

    /// @inheritdoc IChogSwapV2
    function claimable(address account, AssetType assetType, address token, uint256 id)
        external
        view
        returns (uint256)
    {
        return _credits[account][_key(assetType, token, id)];
    }

    // ─────────────────────────────────────────────────────────────── Validation

    /// @dev Checks size, field rules and duplicates. Returns the native amount on the side.
    // Reverting on the first bad asset is the point of this loop.
    // forge-lint: disable-next-item(require-revert-in-loop)
    function _validateSide(Asset[] calldata assets) private view returns (uint256 native) {
        uint256 n = assets.length;
        if (n == 0) revert EmptySide();
        if (n > MAX_ASSETS_PER_SIDE) revert TooManyAssets(n, MAX_ASSETS_PER_SIDE);

        for (uint256 i; i < n; ++i) {
            Asset calldata a = assets[i];
            if (a.assetType == AssetType.Native) {
                if (a.token != address(0) || a.id != 0 || a.amount == 0) revert InvalidAsset(i);
                native = a.amount;
            } else if (a.assetType == AssetType.ERC20) {
                if (a.token.code.length == 0 || a.id != 0 || a.amount == 0) revert InvalidAsset(i);
            } else {
                if (a.token.code.length == 0 || a.amount != 1) revert InvalidAsset(i);
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

    function _same(Asset calldata a, Asset calldata b) private pure returns (bool) {
        return a.assetType == b.assetType && a.token == b.token && a.id == b.id;
    }

    // ─────────────────────────────────────────────────────────────── Internals

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
            IERC721 nft = IERC721(a.token);
            // Reverts if the maker doesn't own the id or hasn't approved us.
            // forge-lint: disable-next-line(calls-loop)
            nft.transferFrom(msg.sender, address(this), a.id);
            // forge-lint: disable-next-line(calls-loop)
            if (nft.ownerOf(a.id) != address(this)) revert NftNotReceived(a.token, a.id);
        }
    }

    function _payoutAll(Asset[] storage assets, address to) private {
        for (uint256 i; i < assets.length; ++i) {
            _payout(to, assets[i]);
        }
    }

    /// @dev Never reverts: if the recipient or the token rejects the transfer, the amount is
    ///      credited for `claim` instead, so one bad party can't block a fill, cancel or reclaim.
    function _payout(address to, Asset storage a) private {
        AssetType assetType = a.assetType;
        address token = a.token;
        uint256 id = a.id;
        uint256 amount = a.amount;
        if (_transferOut(assetType, token, id, amount, to)) return;

        _credits[to][_key(assetType, token, id)] += amount;
        // Only known after the (failed) call; nonReentrant rules out log fabrication.
        // forge-lint: disable-next-line(reentrancy-events)
        emit AssetCredited(to, token, assetType, id, amount);
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
