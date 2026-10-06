// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDeClubIntents} from "./interfaces/IDeClubIntents.sol";
import {FeeAdmin} from "./FeeAdmin.sol";

/// @title DeClubIntents: settle signed swap intents, wallet to wallet
/// @notice See IDeClubIntents for the behaviour spec, docs/adr/0008-trade-intents.md and
///         docs/adr/0009-ring-swaps.md for the reasoning.
/// @dev No upgradeability, no token allowlist, no `receive()`, and an admin over the fee amount
///      only (FeeAdmin). The contract
///      holds no assets: every transfer goes straight from one maker's wallet to the next maker's,
///      so a failed transfer reverts the whole settlement instead of needing a claim path.
///      Every nonce in a cycle is consumed before any asset moves, and `settle` is nonReentrant.
///
///      Protocol fee (docs/adr/0015-protocol-fee.md, docs/adr/0018-adjustable-protocol-fee.md):
///      when a cycle settles, every maker in it pays `fee()` of `FEE_TOKEN` (wrapped MON)
///      straight from their wallet to `FEE_RECIPIENT`, so the contract still holds nothing. Each
///      intent signs the fee token and the most its maker will pay, and `settle` refuses an
///      intent with another token or a `maxFee` below `fee()`. A cut by the fee admin keeps
///      every signed intent valid; a raise makes the ones signed below it stale. A cycle that
///      does not settle charges nobody.
contract DeClubIntents is IDeClubIntents, FeeAdmin, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_CYCLE = 4;
    uint256 public constant MAX_ASSETS_PER_SIDE = 10;

    /// @notice The token every maker pays the fee in: the chain's wrapped MON.
    address public immutable FEE_TOKEN;

    bytes32 private constant ASSET_TYPEHASH =
        keccak256("Asset(uint8 assetType,address token,uint256 id,uint256 amount)");
    bytes32 private constant INTENT_TYPEHASH = keccak256(
        "Intent(address maker,Asset[] give,Asset[] want,address feeToken,uint256 maxFee,uint64 deadline,uint256 nonce)"
        "Asset(uint8 assetType,address token,uint256 id,uint256 amount)"
    );

    /// @dev maker → word (nonce >> 8) → bitmap of used nonces.
    mapping(address maker => mapping(uint256 word => uint256 bitmap)) private _nonceBitmap;

    /// @param feeToken ERC-20 the fee is paid in (wrapped MON). May be zero only when `maxFee`
    ///        is 0.
    /// @param initialFee What each maker pays per settlement, in `feeToken` units, until the fee
    ///        admin changes it. 0 charges nothing.
    /// @param maxFee Ceiling the fee admin can never go above, at most `MAX_FEE_LIMIT`.
    /// @param feeRecipient Receives the fees. Required when `maxFee` is not 0.
    /// @param admin May change the fee within `maxFee`. Zero fixes it for good.
    // A zero fee token is only allowed with a zero ceiling, checked below.
    // forge-lint: disable-next-item(missing-zero-check)
    constructor(
        address feeToken,
        uint256 initialFee,
        uint256 maxFee,
        address feeRecipient,
        address admin
    ) FeeAdmin(initialFee, maxFee, feeRecipient, admin) EIP712("DeClubIntents", "1") {
        if (maxFee != 0 && feeToken.code.length == 0) revert InvalidFeeToken(feeToken);
        FEE_TOKEN = feeToken;
    }

    // ─────────────────────────────────────────────────────────────── Actions

    /// @inheritdoc IDeClubIntents
    // Reverting on the first bad intent is the point of these loops. The event after the
    // signature check can't be reordered: the only external call before it is a staticcall.
    // forge-lint: disable-next-item(require-revert-in-loop, reentrancy-events)
    function settle(Intent[] calldata cycle, bytes[] calldata signatures) external nonReentrant {
        uint256 n = cycle.length;
        if (n < 2 || n > MAX_CYCLE) revert BadCycleSize(n);
        if (signatures.length != n) revert SignatureCountMismatch(n, signatures.length);

        // Checks, and every nonce consumed, before anything moves.
        for (uint256 i; i < n; ++i) {
            Intent calldata it = cycle[i];
            _validateIntent(it, i);

            bytes32 structHash = _hashIntent(it);
            if (!SignatureChecker.isValidSignatureNow(
                    it.maker, _hashTypedDataV4(structHash), signatures[i]
                )) revert BadSignature(i);

            _useNonce(it.maker, it.nonce);

            // Makers must be distinct: no wash trades, and the cycle check stays unambiguous.
            for (uint256 j; j < i; ++j) {
                if (cycle[j].maker == it.maker) revert DuplicateMaker(i);
            }

            emit IntentFilled(structHash, it.maker, cycle[(i + 1) % n].maker, it.nonce);
        }

        // Each maker's `want` must be covered by the previous maker's `give`.
        for (uint256 i; i < n; ++i) {
            _requireCovered(cycle[(i + n - 1) % n].give, cycle[i].want, i);
        }

        // Interactions: pay every `give` in full to the next maker.
        for (uint256 i; i < n; ++i) {
            address from = cycle[i].maker;
            address to = cycle[(i + 1) % n].maker;
            Asset[] calldata give = cycle[i].give;
            for (uint256 k; k < give.length; ++k) {
                _send(from, to, give[k]);
            }
        }

        _chargeFees(cycle);
    }

    /// @inheritdoc IDeClubIntents
    function invalidateNonces(uint256 word, uint256 mask) external {
        _nonceBitmap[msg.sender][word] |= mask;
        emit NoncesInvalidated(msg.sender, word, mask);
    }

    // ─────────────────────────────────────────────────────────────── Views

    /// @inheritdoc IDeClubIntents
    function hashIntent(Intent calldata intent) external pure returns (bytes32) {
        return _hashIntent(intent);
    }

    /// @inheritdoc IDeClubIntents
    function intentDigest(Intent calldata intent) external view returns (bytes32) {
        return _hashTypedDataV4(_hashIntent(intent));
    }

    /// @inheritdoc IDeClubIntents
    // The name is fixed by EIP-712 tooling.
    // forge-lint: disable-next-line(mixed-case-function)
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @inheritdoc IDeClubIntents
    function isNonceUsed(address maker, uint256 nonce) external view returns (bool) {
        return _nonceBitmap[maker][nonce >> 8] & (1 << (nonce & 0xff)) != 0;
    }

    // ─────────────────────────────────────────────────────────────── Hashing

    function _hashIntent(Intent calldata it) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                INTENT_TYPEHASH,
                it.maker,
                _hashAssets(it.give),
                _hashAssets(it.want),
                it.feeToken,
                it.maxFee,
                it.deadline,
                it.nonce
            )
        );
    }

    function _hashAssets(Asset[] calldata assets) private pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](assets.length);
        for (uint256 i; i < assets.length; ++i) {
            Asset calldata a = assets[i];
            hashes[i] = keccak256(abi.encode(ASSET_TYPEHASH, a.assetType, a.token, a.id, a.amount));
        }
        return keccak256(abi.encodePacked(hashes));
    }

    // ─────────────────────────────────────────────────────────────── Validation

    // forge-lint: disable-next-item(require-revert-in-loop, block-timestamp)
    function _validateIntent(Intent calldata it, uint256 index) private view {
        if (it.maker == address(0)) revert InvalidMaker(index);
        if (it.deadline == 0) revert InvalidDeadline(index);
        if (block.timestamp > it.deadline) revert IntentExpired(index);
        // The maker signed the fee token and the most they'll pay; the fee in force must fit.
        if (it.feeToken != FEE_TOKEN || it.maxFee < _fee) {
            revert WrongFee(index, it.feeToken, it.maxFee);
        }

        _validateSide(it.give, index, true);
        _validateSide(it.want, index, false);

        // The same asset on both sides can never be part of a cycle that satisfies this maker.
        for (uint256 i; i < it.give.length; ++i) {
            for (uint256 j; j < it.want.length; ++j) {
                if (_same(it.give[i], it.want[j])) revert SameAssetBothSides(index);
            }
        }
    }

    // Reverting on the first bad asset is the point of this loop.
    // forge-lint: disable-next-item(require-revert-in-loop)
    function _validateSide(Asset[] calldata assets, uint256 intent, bool give) private view {
        uint256 n = assets.length;
        if (n == 0) revert EmptySide(intent, give);
        if (n > MAX_ASSETS_PER_SIDE) revert TooManyAssets(intent, give, n);

        for (uint256 i; i < n; ++i) {
            Asset calldata a = assets[i];
            if (a.assetType == AssetType.ERC20) {
                if (a.token.code.length == 0 || a.id != 0 || a.amount == 0 || _isNft(a.token)) {
                    revert InvalidAsset(intent, give, i);
                }
            } else if (a.assetType == AssetType.ERC721) {
                if (a.token.code.length == 0 || a.amount != 1 || !_isNft(a.token)) {
                    revert InvalidAsset(intent, give, i);
                }
            } else {
                // Native (not pullable from a wallet).
                revert InvalidAsset(intent, give, i);
            }
            for (uint256 j; j < i; ++j) {
                if (_same(assets[j], a)) revert DuplicateAsset(intent, give, i);
            }
        }
    }

    /// @dev Every asset in `want` must be in `gives`: ERC-20 with at least that amount, an NFT
    ///      with the same id.
    // forge-lint: disable-next-item(require-revert-in-loop)
    function _requireCovered(Asset[] calldata gives, Asset[] calldata want, uint256 intent)
        private
        pure
    {
        for (uint256 w; w < want.length; ++w) {
            bool covered = false;
            for (uint256 g; g < gives.length; ++g) {
                if (_same(gives[g], want[w]) && gives[g].amount >= want[w].amount) {
                    covered = true;
                    break;
                }
            }
            if (!covered) revert WantNotMet(intent, w);
        }
    }

    function _same(Asset calldata a, Asset calldata b) private pure returns (bool) {
        return a.assetType == b.assetType && a.token == b.token && a.id == b.id;
    }

    /// @dev ERC-20 and ERC-721 `transferFrom` share a selector, so an asset's declared type has to
    ///      match the contract behind it. Otherwise "1 unit of an ERC-20" at an NFT collection
    ///      would move NFT #1 (and pass the balance check, which rises by one).
    function _isNft(address token) private view returns (bool) {
        return ERC165Checker.supportsInterface(token, type(IERC721).interfaceId);
    }

    // ─────────────────────────────────────────────────────────────── Internals

    /// @dev Every maker in the settled cycle pays the fee from their wallet to the recipient. A
    ///      maker without the balance or the approval reverts the whole settlement.
    // `from` is arbitrary on purpose: it is a maker whose signature `settle` just verified, and
    // the signature covers the fee token and the most they agreed to pay.
    // forge-lint: disable-next-item(require-revert-in-loop, calls-loop, arbitrary-send-erc20)
    function _chargeFees(Intent[] calldata cycle) private {
        uint256 share = _fee;
        if (share == 0) return;
        IERC20 token = IERC20(FEE_TOKEN);
        address to = FEE_RECIPIENT;
        uint256 n = cycle.length;
        for (uint256 i; i < n; ++i) {
            token.safeTransferFrom(cycle[i].maker, to, share);
        }
        // forge-lint: disable-next-line(reentrancy-events)
        emit FeeCharged(to, address(token), share * n);
    }

    // forge-lint: disable-next-item(require-revert-in-loop)
    function _useNonce(address maker, uint256 nonce) private {
        uint256 word = nonce >> 8;
        uint256 bit = 1 << (nonce & 0xff);
        uint256 bitmap = _nonceBitmap[maker][word];
        if (bitmap & bit != 0) revert NonceUsed(maker, nonce);
        _nonceBitmap[maker][word] = bitmap | bit;
    }

    /// @dev Move one asset from a maker's wallet to the next maker, and verify it arrived. The
    ///      ERC-20 check is deliberate: a token that delivers a different amount than asked
    ///      (fee-on-transfer, rebasing) would leave the receiver short of their `want`.
    // `from` is arbitrary on purpose: it is the maker whose signature `settle` just verified.
    // forge-lint: disable-next-item(require-revert-in-loop, incorrect-strict-equality, arbitrary-send-erc20)
    function _send(address from, address to, Asset calldata a) private {
        if (a.assetType == AssetType.ERC20) {
            IERC20 token = IERC20(a.token);
            // forge-lint: disable-next-line(calls-loop)
            uint256 before = token.balanceOf(to);
            // forge-lint: disable-next-line(calls-loop)
            token.safeTransferFrom(from, to, a.amount);
            // forge-lint: disable-next-line(calls-loop)
            if (token.balanceOf(to) - before != a.amount) revert UnsupportedToken(a.token);
        } else {
            IERC721 nft = IERC721(a.token);
            // Checked before as well as after: with a token whose `transferFrom` silently does
            // nothing, an id `to` already owns would pass the check below.
            // forge-lint: disable-next-line(calls-loop)
            if (nft.ownerOf(a.id) != from) revert NftNotReceived(a.token, a.id);
            // forge-lint: disable-next-line(calls-loop)
            nft.transferFrom(from, to, a.id);
            // forge-lint: disable-next-line(calls-loop)
            if (nft.ownerOf(a.id) != to) revert NftNotReceived(a.token, a.id);
        }
    }
}
