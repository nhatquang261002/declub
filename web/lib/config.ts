import { getAddress, isAddress, type Address } from "viem";

// NEXT_PUBLIC_* values are inlined at build time, so each must be read by its full name.
// The defaults are the Monad testnet deployment (see the root README).
const env = {
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
  chog: process.env.NEXT_PUBLIC_CHOG_ADDRESS,
  swapV2: process.env.NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS,
  mockErc20: process.env.NEXT_PUBLIC_MOCK_ERC20_ADDRESS,
  intents: process.env.NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS,
  rewards: process.env.NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS,
  rewardsEpochSeconds: process.env.NEXT_PUBLIC_REWARDS_EPOCH_SECONDS,
  rewardsGenesis: process.env.NEXT_PUBLIC_REWARDS_GENESIS,
  poolUrl: process.env.NEXT_PUBLIC_POOL_URL,
  chogMintable: process.env.NEXT_PUBLIC_CHOG_MINTABLE,
  knownCollections: process.env.NEXT_PUBLIC_KNOWN_COLLECTIONS,
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  privyEmbedded: process.env.NEXT_PUBLIC_PRIVY_EMBEDDED_WALLETS,
  ipfsGateway: process.env.NEXT_PUBLIC_IPFS_GATEWAY,
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
};

function address(value: string | undefined, fallback: Address): Address {
  return getAddress(value?.trim() || fallback);
}

export const CHAIN_ID = Number(env.chainId || 10143);
// On mainnet nothing may fall back to a testnet default (the RPC, the testnet MockChog).
if (CHAIN_ID === 143 && (!env.rpcUrl?.trim() || !env.chog?.trim())) {
  throw new Error("Mainnet (NEXT_PUBLIC_CHAIN_ID=143) needs NEXT_PUBLIC_RPC_URL and NEXT_PUBLIC_CHOG_ADDRESS set");
}
/**
 * Where the app is served, for the absolute links in a shared deal's preview. NEXT_PUBLIC_SITE_URL,
 * else the host Vercel gives the deployment, else the live app (a production build), else the local dev server.
 */
export const SITE_URL = (
  env.siteUrl?.trim() ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.NODE_ENV === "production"
      ? "https://declub.vercel.app"
      : "http://localhost:3000")
).replace(/\/+$/, "");
export const RPC_URL = env.rpcUrl?.trim() || "https://testnet-rpc.monad.xyz";
export const EXPLORER_URL =
  CHAIN_ID === 143 ? "https://monadvision.com" : "https://testnet.monadvision.com";

export const CHOG_ADDRESS = address(env.chog, "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4");

/**
 * The path gateway `ipfs://` URIs are read through, ending in `/ipfs/`. ipfs.io unless
 * NEXT_PUBLIC_IPFS_GATEWAY says otherwise: it can stall for hours on a CID it hasn't cached.
 */
export const IPFS_GATEWAY = (env.ipfsGateway?.trim() || "https://ipfs.io/ipfs/").replace(/\/*$/, "/");

/**
 * DeClubEscrow, the deal contract (ADR 0005): any ERC-721, ERC-20 and MON. The app has no deals
 * without it, so the deal screens stay off until NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS is set.
 */
export const DECLUB_ESCROW_ADDRESS: Address | undefined = env.swapV2?.trim()
  ? getAddress(env.swapV2.trim())
  : undefined;
/** Test ERC-20 with an open mint, for demoing DeClubEscrow on testnet. */
export const MOCK_ERC20_ADDRESS: Address | undefined = env.mockErc20?.trim()
  ? getAddress(env.mockErc20.trim())
  : undefined;

/**
 * DeClubIntents (ADR 0008): signed swap intents settled by an off-chain matcher. Optional:
 * the intent screens stay off until NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS is set.
 */
export const DECLUB_INTENTS_ADDRESS: Address | undefined = env.intents?.trim()
  ? getAddress(env.intents.trim())
  : undefined;
/**
 * DeClubRewards (ADR 0022): each epoch's Club payouts, claimed against a Merkle root. Optional:
 * the Rewards screens show the pools but no claim button until NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS
 * is set.
 */
export const DECLUB_REWARDS_ADDRESS: Address | undefined = env.rewards?.trim()
  ? getAddress(env.rewards.trim())
  : undefined;
/** Length of a rewards epoch in seconds: a week, or shorter for a demo. */
export const REWARDS_EPOCH_SECONDS = Math.max(60, Number(env.rewardsEpochSeconds || 7 * 86_400));
/** Unix seconds when epoch 0 starts: Monday 2026-10-05 00:00 UTC unless set. */
export const REWARDS_GENESIS = Number(env.rewardsGenesis || 1_791_158_400);
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
/** Whether the deal screens (DeClubEscrow deals) are shown: only when the contract is configured. */
export const SHOW_V2 = !!DECLUB_ESCROW_ADDRESS;
export const SHOW_INTENTS = !!DECLUB_INTENTS_ADDRESS;

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
/** DeClubEscrow.MAX_NFTS_PER_SIDE: the fee is paid per NFT, so one deal can't move more than this many (ADR 0033). */
export const MAX_NFTS_PER_SIDE = 5;
/** DeClubEscrow.MAX_NOTE_BYTES: the limit is in bytes, not characters. */
export const MAX_NOTE_BYTES = 280;
/** DeClubEscrow.MAX_SPEC_BYTES: the stored description of a deal's trait requests. */
export const MAX_SPEC_BYTES = 1024;

export const explorerTx = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER_URL}/address/${addr}`;
