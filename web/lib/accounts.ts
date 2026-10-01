import type { User } from "@privy-io/react-auth";

export type AccountKind = "email" | "google" | "twitter" | "discord" | "wallet";

/** One row of the account screen: a sign-in method or wallet linked to the Privy user. */
export type LinkedRow = {
  kind: AccountKind;
  /** What to show: an email, an @handle or a wallet address. */
  label: string;
  /** What Privy's unlink call takes: an email address, an OAuth subject or a wallet address. */
  id: string;
  /** The wallet Privy created for the user. It can be exported but never unlinked. */
  embedded?: boolean;
};

export type SocialKind = Exclude<AccountKind, "wallet">;

export const KIND_LABEL: Record<AccountKind, string> = {
  email: "Email",
  google: "Google",
  twitter: "X",
  discord: "Discord",
  wallet: "Wallet",
};

/** The linked accounts that can sit beside a wallet, in display order. */
export const SOCIAL_KINDS: SocialKind[] = ["google", "twitter", "discord"];

/** Linked accounts as flat rows. Only the kinds the app offers are listed, Ethereum wallets only. */
export function linkedRows(user: User | null): LinkedRow[] {
  const rows: LinkedRow[] = [];
  for (const account of user?.linkedAccounts ?? []) {
    switch (account.type) {
      case "email":
        rows.push({ kind: "email", label: account.address, id: account.address });
        break;
      case "google_oauth":
        rows.push({ kind: "google", label: account.email, id: account.subject });
        break;
      case "twitter_oauth":
        rows.push({
          kind: "twitter",
          label: account.username ? `@${account.username}` : (account.name ?? "X account"),
          id: account.subject,
        });
        break;
      case "discord_oauth":
        rows.push({ kind: "discord", label: account.username ?? "Discord account", id: account.subject });
        break;
      case "wallet":
        if (account.chainType === "ethereum") {
          rows.push({
            kind: "wallet",
            label: account.address,
            id: account.address,
            embedded: account.walletClientType === "privy",
          });
        }
        break;
    }
  }
  return rows;
}

/** A short "who is signed in" line for the wallet menu: the first email or handle, else nothing. */
export function signedInAs(user: User | null): string | undefined {
  return linkedRows(user).find((row) => row.kind !== "wallet")?.label;
}
