import type { Hex } from "viem";
import { SIGNED_SKEW_SEC, joinTypedData, parseJoinMessage, type JoinMessage } from "../social";
import type { ClubEntry } from "../verifiedAssets";
import { allRows, getMember, joinClub, joinRecordKey, type MemberDeps } from "./members";
import { verifySocialSignature } from "./socialSignature";
import type { Store } from "./store";

/**
 * Signed memberships (ADR 0053). A member row is a Privy user id and a copy of their wallets, and
 * it exists nowhere else, so losing the store loses the Club's list. Each member can sign one
 * message with their Club wallet: "this wallet is on this Club's list". It is kept beside the row,
 * exported with the rest of the backup, and is all a restore needs: nobody can be put back who
 * didn't sign, and the wallet maps to its account through Privy.
 */
export type JoinRecord = { message: JoinMessage; signature: Hex };

export type JoinDeps = {
  /** Epoch ms, like the other deps of the membership routes. */
  now?: () => number;
  verifyJoin?: (message: JoinMessage, signature: Hex) => Promise<boolean>;
};

type JoinRefusal = "unsigned" | "not_member" | "wrong_club" | "wrong_wallet" | "stale" | "bad_signature";

const isSignature = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
const verified = (deps: JoinDeps, message: JoinMessage, signature: Hex) =>
  (deps.verifyJoin ?? ((m, s) => verifySocialSignature(m.wallet, joinTypedData(m), s)))(message, signature);

/**
 * Keeps a member's signed consent. The message must name this Club and the wallet the Members list
 * shows for them, the one wallet their membership already makes public, and be signed by it now.
 */
export async function recordJoin(
  store: Store,
  entry: ClubEntry,
  userId: string,
  body: { message: unknown; signature: unknown },
  deps: JoinDeps = {},
): Promise<{ ok: true } | { ok: false; reason: JoinRefusal }> {
  const message = parseJoinMessage(body.message);
  if (!message || !isSignature(body.signature)) return { ok: false, reason: "unsigned" };
  const row = await getMember(store, entry.address, userId);
  if (!row) return { ok: false, reason: "not_member" };
  if (message.club.toLowerCase() !== entry.address.toLowerCase()) return { ok: false, reason: "wrong_club" };
  if (message.wallet.toLowerCase() !== row.displayWallet) return { ok: false, reason: "wrong_wallet" };
  const now = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  if (Math.abs(message.at - now) > SIGNED_SKEW_SEC) return { ok: false, reason: "stale" };
  if (!(await verified(deps, message, body.signature))) return { ok: false, reason: "bad_signature" };
  await store.set(joinRecordKey(entry.address, userId), { message, signature: body.signature } satisfies JoinRecord);
  return { ok: true };
}

/** Whether the member has signed for the wallet they are shown under now. */
export async function hasSigned(store: Store, token: string, userId: string, displayWallet: string): Promise<boolean> {
  const record = await store.get<JoinRecord>(joinRecordKey(token, userId));
  return record?.message.wallet.toLowerCase() === displayWallet.toLowerCase();
}

/** The Club's signed memberships, for the backup: only those that still match the wallet a member is shown under. */
export async function exportJoins(store: Store, entry: ClubEntry): Promise<JoinRecord[]> {
  const rows = await allRows(store, entry.address);
  const records = await store.getMany<JoinRecord>(rows.map((row) => joinRecordKey(entry.address, row.userId)));
  return rows.flatMap((row, i) => (records[i]?.message.wallet.toLowerCase() === row.displayWallet ? [records[i]!] : []));
}

/** The account that linked a wallet, with every wallet it has linked; `null` when none has. */
export type UserOfWallet = (wallet: string) => Promise<{ userId: string; wallets: readonly string[] } | null>;

/**
 * Puts signed members back on the Club's list after the store was lost. Each record is checked
 * again (right Club, a valid signature from the wallet) and its wallet must still be linked to an
 * account, which is the member. They join as they would by hand, so a ban that survived still
 * holds; their `joinedAt` is the time they signed. A member now shown under another wallet is
 * listed in `resign`: they are back, but need to sign again for the wallet they show.
 */
export async function restoreJoins(
  store: Store,
  entry: ClubEntry,
  records: readonly unknown[],
  userOfWallet: UserOfWallet,
  deps: JoinDeps & { member?: MemberDeps } = {},
): Promise<{ restored: number; resign: string[]; skipped: { wallet: string; reason: string }[] }> {
  let restored = 0;
  const resign: string[] = [];
  const skipped: { wallet: string; reason: string }[] = [];
  for (const raw of records) {
    const r = raw as Partial<JoinRecord> | null;
    const message = parseJoinMessage(r?.message);
    const wallet = message?.wallet ?? "unknown";
    if (!message || !isSignature(r?.signature)) {
      skipped.push({ wallet, reason: "not a signed membership" });
    } else if (message.club.toLowerCase() !== entry.address.toLowerCase()) {
      skipped.push({ wallet, reason: "signed for another Club" });
    } else if (!(await verified(deps, message, r.signature))) {
      skipped.push({ wallet, reason: "the signature isn't from that wallet" });
    } else {
      const user = await userOfWallet(message.wallet);
      if (!user || !user.wallets.some((w) => w.toLowerCase() === message.wallet.toLowerCase())) {
        skipped.push({ wallet, reason: "no account has linked that wallet" });
        continue;
      }
      const joined = await joinClub(store, entry, user.userId, user.wallets, { ...deps.member, now: () => message.at * 1000 });
      if (!joined.ok) {
        skipped.push({ wallet, reason: `can't join: ${joined.reason}` });
        continue;
      }
      restored += 1;
      if (joined.row.displayWallet === message.wallet.toLowerCase()) {
        await store.set(joinRecordKey(entry.address, user.userId), { message, signature: r.signature } satisfies JoinRecord);
      } else resign.push(message.wallet);
    }
  }
  return { restored, resign, skipped };
}
