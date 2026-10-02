import { getAddress, isAddress } from "viem";

/**
 * Verified profiles (ADR 0011): a wallet's linked X or Discord account, shown to other traders
 * when its owner opts in. Privy has already checked both links, so the server only copies what
 * Privy says about the signed-in user. This file is shared by the browser and the server.
 */
export type ProfileProvider = "twitter" | "discord";

/** What other traders get to see. */
export type Profile = { provider: ProfileProvider; handle: string };

/** What the server keeps: the public part, plus who owns the row and when it was written. */
export type StoredProfile = Profile & { userId: string; updatedAt: number };

// Both are what the providers allow, and the check is what makes a handle safe to put in a URL.
const HANDLE: Record<ProfileProvider, RegExp> = {
  twitter: /^[A-Za-z0-9_]{1,15}$/,
  discord: /^[a-z0-9_.]{2,32}$/,
};

export const PROFILE_LABEL: Record<ProfileProvider, string> = { twitter: "X", discord: "Discord" };

/** The profile page, for providers that have one by handle. */
export function profileUrl(profile: Profile): string | undefined {
  return profile.provider === "twitter" ? `https://x.com/${profile.handle}` : undefined;
}

/** Privy's linked accounts as its server SDK returns them (snake_case); only the fields read here are looked at. */
type LinkedAccount = { type: string };
const fields = (account: LinkedAccount) => account as Record<string, unknown>;

/**
 * The profile to show for someone's linked accounts: X if linked, else Discord. Google and email
 * are never shown. `undefined` when neither is linked or the handle isn't one the provider issues.
 */
export function pickProfile(accounts: readonly LinkedAccount[]): Profile | undefined {
  const candidates: [ProfileProvider, string][] = [
    ["twitter", "twitter_oauth"],
    ["discord", "discord_oauth"],
  ];
  for (const [provider, type] of candidates) {
    const account = accounts.find((a) => a.type === type);
    const username = account ? fields(account).username : undefined;
    const handle = typeof username === "string" ? username : "";
    if (HANDLE[provider].test(handle)) return { provider, handle };
  }
  return undefined;
}

/** The Ethereum wallets linked to someone, checksummed. Smart wallets and other chains are left out. */
export function linkedEthereumWallets(accounts: readonly LinkedAccount[]): `0x${string}`[] {
  const out = new Set<`0x${string}`>();
  for (const account of accounts) {
    const { chain_type, address } = fields(account);
    if (account.type === "wallet" && chain_type === "ethereum" && typeof address === "string" && isAddress(address)) {
      out.add(getAddress(address));
    }
  }
  return [...out];
}

export const profileKey = (address: string) => `ondeal:profile:${address.toLowerCase()}`;
export const userWalletsKey = (userId: string) => `ondeal:profile-user:${userId}`;
