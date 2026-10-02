import { getAddress, isAddress, type Address } from "viem";

// NEXT_PUBLIC_* values are inlined at build time, so each must be read by its full name.
// The defaults are the Phase 1 Monad testnet deployment (see the root README).
const env = {
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
  chog: process.env.NEXT_PUBLIC_CHOG_ADDRESS,
  swap: process.env.NEXT_PUBLIC_ON_DEAL_ADDRESS,
  deployBlock: process.env.NEXT_PUBLIC_ON_DEAL_DEPLOY_BLOCK,
  swapV2: process.env.NEXT_PUBLIC_ON_DEAL_V2_ADDRESS,
  mockErc20: process.env.NEXT_PUBLIC_MOCK_ERC20_ADDRESS,
  intents: process.env.NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS,
  poolUrl: process.env.NEXT_PUBLIC_POOL_URL,
  chogMintable: process.env.NEXT_PUBLIC_CHOG_MINTABLE,
  knownCollections: process.env.NEXT_PUBLIC_KNOWN_COLLECTIONS,
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  privyEmbedded: process.env.NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS,
};

function address(value: string | undefined, fallback: Address): Address {
  return getAddress(value?.trim() || fallback);
}

export const CHAIN_ID = Number(env.chainId || 10143);
export const RPC_URL = env.rpcUrl?.trim() || "https://testnet-rpc.monad.xyz";
export const EXPLORER_URL = "https://testnet.monadvision.com";

export const CHOG_ADDRESS = address(env.chog, "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4");
export const ON_DEAL_ADDRESS = address(env.swap, "0xA3301cec17d13eD03E343cdfdd14Ab027b8ec298");
export const ON_DEAL_DEPLOY_BLOCK = BigInt(env.deployBlock || 66352698);

/**
 * The generic multi-asset contract (Phase 4, ADR 0005). Optional: it isn't in the Phase 1
 * deployment, so V2 features stay off until NEXT_PUBLIC_ON_DEAL_V2_ADDRESS is set.
 */
export const ON_DEAL_V2_ADDRESS: Address | undefined = env.swapV2?.trim()
  ? getAddress(env.swapV2.trim())
  : undefined;
/** Test ERC-20 with an open mint, for demoing V2 on testnet. */
export const MOCK_ERC20_ADDRESS: Address | undefined = env.mockErc20?.trim()
  ? getAddress(env.mockErc20.trim())
  : undefined;

/**
 * OnDealIntents (ADR 0008): signed swap intents settled by an off-chain matcher. Optional:
 * the intent screens stay off until NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS is set.
 */
export const ON_DEAL_INTENTS_ADDRESS: Address | undefined = env.intents?.trim()
  ? getAddress(env.intents.trim())
  : undefined;
/** The intent pool's HTTP API (matcher/). The matcher binds to loopback by default. */
export const POOL_URL = (env.poolUrl?.trim() || "http://127.0.0.1:8787").replace(/\/+$/, "");
/** The pool refuses intents that end sooner or later than this (matcher/src/pool.ts). */
export const POOL_MIN_TTL_SEC = 60;
export const POOL_MAX_TTL_SEC = 7 * 86_400;

/**
 * Collections the NFT picker offers first, besides the Chog collection (comma-separated
 * addresses in NEXT_PUBLIC_KNOWN_COLLECTIONS). Anything else is found by pasting its address, or
 * from the open deals. Entries that aren't addresses are ignored.
 */
export const KNOWN_COLLECTIONS: Address[] = (env.knownCollections ?? "")
  .split(",")
  .map((a) => a.trim())
  .filter((a) => isAddress(a))
  .map((a) => getAddress(a));

/** MockChog has an open `mint`. Set NEXT_PUBLIC_CHOG_MINTABLE=false for the real collection. */
export const CHOG_MINTABLE = env.chogMintable !== "false";
export const DEMO_DEALS =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO_DEALS !== "false";
export const DEMO_CREATE =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO_CREATE === "true";

/**
 * Privy app id (ADR 0010). Optional: blank keeps the plain injected-wallet connect, so the app
 * runs without a Privy account. Set it to add email / Google / X / Discord sign-in, embedded
 * wallets and linked accounts.
 */
export const PRIVY_APP_ID = env.privyAppId?.trim() || undefined;
/**
 * Whether Privy makes a wallet for people who sign in with a social account. Off by default: the
 * app is wallet-first, so a social sign-in is another way into a wallet you already own. Turn on
 * (NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS=true) only after enabling embedded wallets in the Privy dashboard.
 */
export const PRIVY_EMBEDDED_WALLETS = env.privyEmbedded === "true";

export const MAX_TOKENS_PER_SIDE = 10;
/** OnDealV2.MAX_NOTE_BYTES: the limit is in bytes, not characters. */
export const MAX_NOTE_BYTES = 280;
/** OnDealV2.MAX_SPEC_BYTES: the stored description of a deal's trait requests. */
export const MAX_SPEC_BYTES = 1024;

export const explorerTx = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER_URL}/address/${addr}`;
