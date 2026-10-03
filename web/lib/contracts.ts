import { erc20Abi, parseAbi, type Abi } from "viem";
import { onDealIntentsAbi, onDealV2Abi, mockChogAbi } from "./abi";
import { CHAIN_ID, CHOG_ADDRESS, ON_DEAL_INTENTS_ADDRESS, ON_DEAL_V2_ADDRESS } from "./config";

export const chog = { address: CHOG_ADDRESS, abi: mockChogAbi, chainId: CHAIN_ID } as const;

// V2 moves NFTs and ERC-20s, so their revert errors (ERC721InsufficientApproval, ...) bubble up
// through it, and the swap ABI carries them so viem can decode them by name. viem's erc20Abi has
// no errors, so the OpenZeppelin ones are declared here.
const chogErrors = mockChogAbi.filter((item) => item.type === "error");
const erc20Errors = [
  { type: "error", name: "ERC20InsufficientBalance", inputs: [{ name: "sender", type: "address" }, { name: "balance", type: "uint256" }, { name: "needed", type: "uint256" }] },
  { type: "error", name: "ERC20InsufficientAllowance", inputs: [{ name: "spender", type: "address" }, { name: "allowance", type: "uint256" }, { name: "needed", type: "uint256" }] },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },
] as const satisfies Abi;
export const swapV2Abi = [...onDealV2Abi, ...chogErrors, ...erc20Errors] as const;

/** Spread into read/write calls: `{ ...swapV2, functionName, args }`. Undefined until NEXT_PUBLIC_ON_DEAL_V2_ADDRESS is set. */
export const swapV2 = ON_DEAL_V2_ADDRESS
  ? ({ address: ON_DEAL_V2_ADDRESS, abi: swapV2Abi, chainId: CHAIN_ID } as const)
  : undefined;

/**
 * OnDealIntents (ADR 0008). It holds no assets, so the only call the app makes is
 * `invalidateNonces`; everything else it does is signed off-chain and sent by the matcher.
 * Undefined until NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS is set.
 */
export const swapIntents = ON_DEAL_INTENTS_ADDRESS
  ? ({ address: ON_DEAL_INTENTS_ADDRESS, abi: onDealIntentsAbi, chainId: CHAIN_ID } as const)
  : undefined;

/**
 * Wrapped MON, the fee token of OnDealIntents (ADR 0015). `deposit` wraps native MON one to
 * one (the WETH9 interface), which is how a wallet holding only MON can pay the fee.
 */
export const wmonAbi = parseAbi([
  "function deposit() payable",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/** The ERC-721 calls the V2 and intent screens make on any collection. */
export const erc721Abi = parseAbi([
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function approve(address to, uint256 tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

export { erc20Abi };
