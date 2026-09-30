import { getAddress, type Address } from "viem";

// NEXT_PUBLIC_* values are inlined at build time, so each must be read by its full name.
// The defaults are the Phase 1 Monad testnet deployment (see the root README).
const env = {
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
  chog: process.env.NEXT_PUBLIC_CHOG_ADDRESS,
  swap: process.env.NEXT_PUBLIC_CHOG_SWAP_ADDRESS,
  deployBlock: process.env.NEXT_PUBLIC_CHOG_SWAP_DEPLOY_BLOCK,
  swapV2: process.env.NEXT_PUBLIC_CHOG_SWAP_V2_ADDRESS,
  mockErc20: process.env.NEXT_PUBLIC_MOCK_ERC20_ADDRESS,
  chogMintable: process.env.NEXT_PUBLIC_CHOG_MINTABLE,
};

function address(value: string | undefined, fallback: Address): Address {
  return getAddress(value?.trim() || fallback);
}

export const CHAIN_ID = Number(env.chainId || 10143);
export const RPC_URL = env.rpcUrl?.trim() || "https://testnet-rpc.monad.xyz";
export const EXPLORER_URL = "https://testnet.monadvision.com";

export const CHOG_ADDRESS = address(env.chog, "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4");
export const CHOG_SWAP_ADDRESS = address(env.swap, "0xA3301cec17d13eD03E343cdfdd14Ab027b8ec298");
export const CHOG_SWAP_DEPLOY_BLOCK = BigInt(env.deployBlock || 66352698);

/**
 * The generic multi-asset contract (Phase 4, ADR 0005). Optional: it isn't in the Phase 1
 * deployment, so V2 features stay off until NEXT_PUBLIC_CHOG_SWAP_V2_ADDRESS is set.
 */
export const CHOG_SWAP_V2_ADDRESS: Address | undefined = env.swapV2?.trim()
  ? getAddress(env.swapV2.trim())
  : undefined;
/** Test ERC-20 with an open mint, for demoing V2 on testnet. */
export const MOCK_ERC20_ADDRESS: Address | undefined = env.mockErc20?.trim()
  ? getAddress(env.mockErc20.trim())
  : undefined;

/** MockChog has an open `mint`. Set NEXT_PUBLIC_CHOG_MINTABLE=false for the real collection. */
export const CHOG_MINTABLE = env.chogMintable !== "false";
export const DEMO_DEALS =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO_DEALS !== "false";
export const DEMO_CREATE =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO_CREATE === "true";

export const MAX_TOKENS_PER_SIDE = 10;
/** ChogSwapV2.MAX_NOTE_BYTES: the limit is in bytes, not characters. */
export const MAX_NOTE_BYTES = 280;
/** ChogSwapV2.MAX_SPEC_BYTES: the stored description of a deal's trait requests. */
export const MAX_SPEC_BYTES = 1024;

export const explorerTx = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER_URL}/address/${addr}`;
