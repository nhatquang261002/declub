import { chogSwapAbi, mockChogAbi } from "./abi";
import { CHAIN_ID, CHOG_ADDRESS, CHOG_SWAP_ADDRESS } from "./config";

// Chog errors (ERC721InsufficientApproval, ERC721IncorrectOwner, ...) bubble up through
// ChogSwap, so the swap ABI carries them too. That lets viem decode them by name.
const chogErrors = mockChogAbi.filter((item) => item.type === "error");
export const swapAbi = [...chogSwapAbi, ...chogErrors] as const;

/** Spread into read/write calls: `{ ...swap, functionName, args }`. */
export const swap = { address: CHOG_SWAP_ADDRESS, abi: swapAbi, chainId: CHAIN_ID } as const;
export const chog = { address: CHOG_ADDRESS, abi: mockChogAbi, chainId: CHAIN_ID } as const;
