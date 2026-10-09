import { CHAIN_ID } from "../config";
import { SPONSOR_NAME_MAX, type PublishedSponsor, type Sponsorship } from "../rewards";
import type { SponsorBackup } from "./sponsorRoutes";
import type { Store } from "./store";

/**
 * Sponsors' money for an epoch (ADR 0035): who added how much to which Club's Holder pool. The
 * operator records it before the epoch is built, from MON the sponsor sent them, and the builder
 * folds it into the pool. A built epoch keeps its own copy, so this ledger is only read for epochs
 * still to build and for the running one's "sponsored" note.
 */
export const sponsorKey = (n: number) => `declub:rewards:${CHAIN_ID}:sponsors:${n}`;

export async function readSponsors(store: Store, n: number): Promise<Sponsorship[]> {
  return (await store.get<Sponsorship[]>(sponsorKey(n))) ?? [];
}

/**
 * The sponsorships of epochs `from` to `to` in the form `restoreSponsors` takes. The ledger is the
 * only place a payment is tied to its Club and name, so this is the backup of it (ADR 0053). An
 * entry from before signatures were kept, or one the operator wrote by hand, can't be restored from
 * the chain: it comes back in `unsigned` to be noted somewhere else.
 */
export async function exportSponsors(store: Store, from: number, to: number): Promise<{ records: SponsorBackup[]; unsigned: Sponsorship[] }> {
  const records: SponsorBackup[] = [];
  const unsigned: Sponsorship[] = [];
  for (let epoch = from; epoch <= to; epoch++) {
    for (const e of await readSponsors(store, epoch)) {
      if (e.tx && e.signature) records.push({ epoch, club: e.club, tx: e.tx, name: e.sponsor, signature: e.signature });
      else unsigned.push(e);
    }
  }
  return { records, unsigned };
}

/** A name safe to show: one line, no control characters, at most `SPONSOR_NAME_MAX` characters. */
export function cleanSponsorName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SPONSOR_NAME_MAX)
    .trim();
}

type ClubSponsors = { total: bigint; sponsors: PublishedSponsor[] };

/** The ledger by Club (lowercase). The same sponsor (name, kind and wallet) adding twice to a Club shows once, with the sum. */
export function sponsorsByClub(entries: readonly Sponsorship[]): Map<string, ClubSponsors> {
  const byClub = new Map<string, ClubSponsors>();
  for (const e of entries) {
    const amount = BigInt(e.amount);
    if (amount <= 0n) continue;
    const club = e.club.toLowerCase();
    const line = byClub.get(club) ?? { total: 0n, sponsors: [] };
    line.total += amount;
    const same = line.sponsors.find((s) => s.sponsor === e.sponsor && s.kind === e.kind && s.by === e.by);
    if (same) same.amount = (BigInt(same.amount) + amount).toString();
    else line.sponsors.push({ sponsor: e.sponsor, kind: e.kind, amount: amount.toString(), ...(e.by ? { by: e.by } : {}) });
    byClub.set(club, line);
  }
  return byClub;
}
