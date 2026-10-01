import { erc20Abi, parseAbi, type Abi } from "viem";
import { chogSwapAbi, chogSwapIntentsAbi, chogSwapV2Abi, mockChogAbi } from "./abi";
import { CHAIN_ID, CHOG_ADDRESS, CHOG_SWAP_ADDRESS, CHOG_SWAP_INTENTS_ADDRESS, CHOG_SWAP_V2_ADDRESS } from "./config";

// Chog errors (ERC721InsufficientApproval, ERC721IncorrectOwner, ...) bubble up through
// ChogSwap, so the swap ABI carries them too. That lets viem decode them by name.
const chogErrors = mockChogAbi.filter((item) => item.type === "error");
export const swapAbi = [...chogSwapAbi, ...chogErrors] as const;

/** Spread into read/write calls: `{ ...swap, functionName, args }`. */
export const swap = { address: CHOG_SWAP_ADDRESS, abi: swapAbi, chainId: CHAIN_ID } as const;
export const chog = { address: CHOG_ADDRESS, abi: mockChogAbi, chainId: CHAIN_ID } as const;

// V2 moves ERC-20s and NFTs too, so their revert errors bubble up through it. viem's erc20Abi
// has no errors, so the OpenZeppelin ones are declared here to be decoded by name.
const erc20Errors = [
  { type: "error", name: "ERC20InsufficientBalance", inputs: [{ name: "sender", type: "address" }, { name: "balance", type: "uint256" }, { name: "needed", type: "uint256" }] },
  { type: "error", name: "ERC20InsufficientAllowance", inputs: [{ name: "spender", type: "address" }, { name: "allowance", type: "uint256" }, { name: "needed", type: "uint256" }] },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },
] as const satisfies Abi;
export const swapV2Abi = [...chogSwapV2Abi, ...chogErrors, ...erc20Errors] as const;

/** Spread into read/write calls, like `swap`. Undefined until NEXT_PUBLIC_CHOG_SWAP_V2_ADDRESS is set. */
export const swapV2 = CHOG_SWAP_V2_ADDRESS
  ? ({ address: CHOG_SWAP_V2_ADDRESS, abi: swapV2Abi, chainId: CHAIN_ID } as const)
  : undefined;

/**
 * ChogSwapIntents (ADR 0008). It holds no assets, so the only call the app makes is
 * `invalidateNonces`; everything else it does is signed off-chain and sent by the matcher.
 * Undefined until NEXT_PUBLIC_CHOG_SWAP_INTENTS_ADDRESS is set.
 */
export const swapIntents = CHOG_SWAP_INTENTS_ADDRESS
  ? ({ address: CHOG_SWAP_INTENTS_ADDRESS, abi: chogSwapIntentsAbi, chainId: CHAIN_ID } as const)
  : undefined;

/** The ERC-721 calls the V2 and intent screens make on any collection. */
export const erc721Abi = parseAbi([
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function approve(address to, uint256 tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

export { erc20Abi };
