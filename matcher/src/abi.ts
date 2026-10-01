import { parseAbi } from "viem";

/** The slice of `ChogSwapIntents` the pool and matcher use. Checked against the build in tests. */
export const intentsAbi = parseAbi([
  "struct Asset { uint8 assetType; address token; uint256 id; uint256 amount; }",
  "struct Intent { address maker; Asset[] give; Asset[] want; uint64 deadline; uint256 nonce; }",
  "function settle(Intent[] cycle, bytes[] signatures)",
  "function isNonceUsed(address maker, uint256 nonce) view returns (bool)",
  "function hashIntent(Intent intent) pure returns (bytes32)",
  "function intentDigest(Intent intent) view returns (bytes32)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function MAX_CYCLE() view returns (uint256)",
  "event IntentFilled(bytes32 indexed intentHash, address indexed maker, address indexed recipient, uint256 nonce)",
  "error BadCycleSize(uint256 size)",
  "error SignatureCountMismatch(uint256 intents, uint256 signatures)",
  "error InvalidMaker(uint256 intent)",
  "error InvalidDeadline(uint256 intent)",
  "error IntentExpired(uint256 intent)",
  "error EmptySide(uint256 intent, bool give)",
  "error TooManyAssets(uint256 intent, bool give, uint256 count)",
  "error InvalidAsset(uint256 intent, bool give, uint256 index)",
  "error DuplicateAsset(uint256 intent, bool give, uint256 index)",
  "error SameAssetBothSides(uint256 intent)",
  "error BadSignature(uint256 intent)",
  "error NonceUsed(address maker, uint256 nonce)",
  "error DuplicateMaker(uint256 intent)",
  "error WantNotMet(uint256 intent, uint256 wantIndex)",
  "error UnsupportedToken(address token)",
  "error NftNotReceived(address token, uint256 id)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const erc721Abi = parseAbi([
  "function ownerOf(uint256 id) view returns (address)",
  "function getApproved(uint256 id) view returns (address)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
]);

export const erc1271Abi = parseAbi([
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
]);
