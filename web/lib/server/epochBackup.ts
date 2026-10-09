import type { Address, Hex } from "viem";
import { CHAIN_ID, DECLUB_REWARDS_ADDRESS } from "../config";
import { rewardLeaf, type EpochRecord, type ReachRecord } from "../rewards";
import { backingRecordKey, type PublishedBacking } from "./backing";
import { heldKey, type Held } from "./held";
import { carriedInFrom, verifyEpochRecord } from "./rewardsVerify";
import { closingKey, epochKey, finishEpoch, lastKey, pointsKey, readEpoch, reachKey, type Closing, type PublishedLedger } from "./rewards";
import { readSponsors, sponsorsByClub } from "./sponsors";
import type { Store } from "./store";

/**
 * A built epoch as a file (ADR 0054). The record, with every claimant's proof, exists only in the
 * store, and so do the inputs it was built from, frozen when the epoch closed: the holdings average,
 * the likes and replies that stood, the active days. Lose the store after a root is published and
 * Holders can't claim, because the inputs to rebuild the same root are gone. This keeps them.
 *
 * Sponsors are not in it: `rewards:sponsor --export` covers them, and must be restored first, since
 * a built epoch's ledger can't be written to.
 */
export type EpochBackup = {
  version: 1;
  n: number;
  record: EpochRecord;
  /** The public points ledger and backing record of each Club, as published. */
  points: Record<string, PublishedLedger> | null;
  backing: Record<string, PublishedBacking> | null;
  /** Each Club's frozen inputs. These hold Privy user ids: the file is private. */
  closings: Record<string, Closing>;
  /** Each Club's daily holdings samples. */
  held: Record<string, Held>;
  reach: ReachRecord | null;
};

/** Epoch `n` as a backup, or null when it hasn't been built. */
export async function exportEpoch(store: Store, n: number): Promise<EpochBackup | null> {
  const record = await readEpoch(store, n);
  if (!record) return null;
  const clubs = record.clubs.map((c) => c.club);
  const closings = await store.getMany<Closing>(clubs.map((c) => closingKey(c, n)));
  const held = await store.getMany<Held>(clubs.map((c) => heldKey(c, n)));
  return {
    version: 1,
    n,
    record,
    points: await store.get(pointsKey(n)),
    backing: await store.get(backingRecordKey(n)),
    closings: Object.fromEntries(clubs.flatMap((c, i) => (closings[i] ? [[c, closings[i]!] as const] : []))),
    held: Object.fromEntries(clubs.flatMap((c, i) => (held[i] ? [[c, held[i]!] as const] : []))),
    reach: await store.get(reachKey(n)),
  };
}

export type RestoreDeps = {
  chainId?: number;
  contract?: Address;
  /** Allow a first epoch above 0, when the earlier ones are claimed and swept and aren't wanted back. Carry and streaks then start there. */
  allowGap?: boolean;
  /** What `DeClubRewards.epochs(n)` holds, or null when it isn't published (or can't be read). */
  onChain?: (n: number) => Promise<{ root: Hex; total: bigint } | null>;
};

export type RestoreResult =
  | { status: "restored" | "exists" }
  | { status: "refused"; reason: string }
  /** Epochs are put back in order: `expected` comes next. */
  | { status: "out_of_order"; expected: number };

const ZERO_ROOT = `0x${"0".repeat(64)}`;

/**
 * Puts a backed-up epoch back after the store was lost. It checks the record before it writes
 * anything: it must be for this chain and rewards contract, its root must be the tree of its
 * leaves with every proof opening, its money must add up (`verifyEpochRecord`, against the epochs
 * already restored), and, when the epoch is published, its root and total must be the chain's. It
 * never replaces a different epoch, and restoring one that is there finishes it if it was left
 * half done. It starts at epoch 0 unless told a gap is fine. The record goes in last-but-one, so a restore that stops is finished by running it again.
 */
export async function restoreEpoch(store: Store, backup: EpochBackup, deps: RestoreDeps = {}): Promise<RestoreResult> {
  const record = backup?.record;
  const chainId = deps.chainId ?? CHAIN_ID;
  const contract = deps.contract ?? DECLUB_REWARDS_ADDRESS;
  if (!contract) return { status: "refused", reason: "no rewards contract is configured" };
  if (backup?.version !== 1 || !record || !Number.isInteger(record.n) || record.n < 0 || record.n !== backup.n) {
    return { status: "refused", reason: "not an epoch backup" };
  }
  const n = record.n;

  const earlier: EpochRecord[] = [];
  for (let k = n - 1; k >= 0; k--) {
    const r = await readEpoch(store, k);
    if (r) earlier.push(r);
  }
  const leafHashes = (record.leaves ?? []).map((l) => rewardLeaf(chainId, contract, n, l.account, BigInt(l.amount)));
  const checked = verifyEpochRecord({
    record,
    expected: { n, chainId, contract },
    carriedIn: carriedInFrom(earlier, n),
    sponsored: new Map([...sponsorsByClub(await readSponsors(store, n))].map(([club, s]) => [club, s.total])),
    leafHashes,
    previousTotal: earlier[0] ? BigInt(earlier[0].total) : null,
  });
  if (checked.problems.length > 0) return { status: "refused", reason: checked.problems.join(" ") };

  const onChain = await deps.onChain?.(n);
  if (onChain && onChain.root !== ZERO_ROOT) {
    if (onChain.root.toLowerCase() !== record.root.toLowerCase())
      return { status: "refused", reason: `epoch ${n} is published on chain with root ${onChain.root}, not the backup's` };
    if (onChain.total !== BigInt(record.total))
      return { status: "refused", reason: `epoch ${n} is funded on chain with ${onChain.total} wei, not the backup's ${record.total}` };
  }

  const last = await store.get<number>(lastKey());
  const existing = await readEpoch(store, n);
  if (!existing && last === null && n > 0 && !deps.allowGap) {
    return { status: "refused", reason: `epoch ${n - 1} isn't restored yet. Restore from epoch 0 in order: the carry and the streaks run through every epoch` };
  }
  if (existing) {
    if (existing.root.toLowerCase() !== record.root.toLowerCase()) return { status: "refused", reason: `a different epoch ${n} is already stored` };
    if (last === null || last < n) await finishEpoch(store, existing);
    return { status: "exists" };
  }
  if (last !== null && n !== last + 1) return { status: "out_of_order", expected: last + 1 };

  for (const [club, closing] of Object.entries(backup.closings ?? {})) await store.set(closingKey(club, n), closing);
  for (const [club, held] of Object.entries(backup.held ?? {})) await store.set(heldKey(club, n), held);
  if (backup.reach) await store.set(reachKey(n), backup.reach);
  if (backup.points) await store.set(pointsKey(n), backup.points);
  if (backup.backing) await store.set(backingRecordKey(n), backup.backing);
  await store.set(epochKey(n), record);
  await finishEpoch(store, record);
  return { status: "restored" };
}
