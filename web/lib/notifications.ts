import { expiryLabel, formatIds, formatMon } from "./format";
import { displayStatus, sameAddress } from "./deals";
import type { DealV2 } from "./dealsV2";
import { reasonText, type PoolIntent } from "./intents";

export type NotificationKind =
  | "request"
  | "filled"
  | "expiring"
  | "expired"
  | "intent-settled"
  | "intent-paused"
  | "intent-dropped";

/** Kinds that report something that already happened and need nothing from the user. */
export const NEWS_KINDS: readonly NotificationKind[] = ["filled", "intent-settled", "intent-dropped"];

export type AppNotification = {
  /** Stable per (kind, deal or intent), so read state survives reloads. */
  key: string;
  kind: NotificationKind;
  /** Newest first within a group: a deal's id, or an intent's creation time. */
  recency: bigint;
  title: string;
  body: string;
  href: string;
  /** Needs a transaction from the user (accept, reclaim), as opposed to informational. */
  actionable: boolean;
};

/** A maker's open deal is "expiring" inside this window. */
export const EXPIRING_WINDOW_SEC = 3_600;

/** "#12, #40 + 2 tokens + 1.5 MON". Token amounts need their decimals, so ERC-20s are only counted. */
const offerSummary = (deal: DealV2) => {
  const ids = deal.offered.flatMap((a) => (a.kind === "erc721" ? [a.id] : []));
  const tokens = deal.offered.filter((a) => a.kind === "erc20").length;
  const mon = deal.offered.reduce((sum, a) => (a.kind === "native" ? sum + a.amount : sum), 0n);
  const parts = [
    ids.length ? formatIds(ids) : null,
    tokens ? `${tokens} token${tokens === 1 ? "" : "s"}` : null,
    mon > 0n ? formatMon(mon) : null,
  ].filter(Boolean);
  return parts.join(" + ") || "assets";
};

/**
 * What the wallet should hear about, derived from the current deal list. There is no event
 * stream to subscribe to (ADR 0003), so every notification is a pure function of deal state
 * and can be recomputed on any device.
 *
 * - request:  someone sent me a direct offer that is still open
 * - filled:   a deal I made was accepted
 * - expiring: my open deal ends within EXPIRING_WINDOW_SEC
 * - expired:  my open deal ran out; the escrow is still locked until someone reclaims it
 */
export function deriveNotifications(
  deals: readonly DealV2[],
  account: string | undefined,
  nowSec: number,
): AppNotification[] {
  if (!account) return [];
  const out: AppNotification[] = [];

  for (const deal of deals) {
    const status = displayStatus(deal, nowSec);
    const href = `/v2/deal/${deal.id}`;
    const mine = sameAddress(deal.maker, account);

    if (!mine && sameAddress(deal.taker, account) && status === "open") {
      out.push({
        key: `request:${deal.id}`,
        kind: "request",
        recency: deal.id,
        title: `Direct offer #${deal.id} for you`,
        body: `Offering ${offerSummary(deal)}. ${expiryLabel(deal.expiry, nowSec)}.`,
        href,
        actionable: true,
      });
    }

    if (!mine) continue;

    if (status === "filled") {
      out.push({
        key: `filled:${deal.id}`,
        kind: "filled",
        recency: deal.id,
        title: `Deal #${deal.id} was accepted`,
        body: `Your ${offerSummary(deal)} was swapped.`,
        href,
        actionable: false,
      });
    } else if (status === "expired") {
      out.push({
        key: `expired:${deal.id}`,
        kind: "expired",
        recency: deal.id,
        title: `Deal #${deal.id} expired`,
        body: "Nobody accepted it. Reclaim your assets from escrow.",
        href,
        actionable: true,
      });
    } else if (status === "open" && deal.expiry !== 0n && Number(deal.expiry) - nowSec <= EXPIRING_WINDOW_SEC) {
      out.push({
        key: `expiring:${deal.id}`,
        kind: "expiring",
        recency: deal.id,
        title: `Deal #${deal.id} is about to expire`,
        body: `${expiryLabel(deal.expiry, nowSec)}. Cancel or let it lapse and reclaim.`,
        href,
        actionable: false,
      });
    }
  }

  return sortNotifications(out);
}

/** Actionable first, then newest first. */
export function sortNotifications(list: AppNotification[]): AppNotification[] {
  return list.sort(
    (a, b) => Number(b.actionable) - Number(a.actionable) || (a.recency < b.recency ? 1 : a.recency > b.recency ? -1 : 0),
  );
}

/**
 * What the wallet should hear about its signed intents, derived from the pool the same way:
 * - intent-settled: matched and swapped (the one a maker is waiting for)
 * - intent-paused:  the matcher skips it because the wallet can't honour it; fixing that revives it
 * - intent-dropped: the matcher gave up on it after repeated on-chain failures
 */
export function deriveIntentNotifications(
  rows: readonly PoolIntent[],
  account: string | undefined,
  nowSec: number,
): AppNotification[] {
  if (!account) return [];
  const out: AppNotification[] = [];

  for (const row of rows) {
    if (!sameAddress(row.intent.maker, account)) continue;
    const id = `${row.hash.slice(0, 8)}…`;
    const base = { href: `/intent/${row.hash}`, recency: BigInt(row.createdAt) };

    if (row.status === "settled") {
      out.push({ ...base, key: `intent-settled:${row.hash}`, kind: "intent-settled", title: `Intent ${id} settled`, body: "It was matched and swapped on-chain.", actionable: false });
    } else if (row.status === "stale" && row.intent.deadline >= BigInt(nowSec)) {
      out.push({ ...base, key: `intent-paused:${row.hash}`, kind: "intent-paused", title: `Intent ${id} is paused`, body: reasonText(row.reason) ?? "Your wallet can't honour it right now.", actionable: true });
    } else if (row.status === "rejected") {
      out.push({ ...base, key: `intent-dropped:${row.hash}`, kind: "intent-dropped", title: `Intent ${id} was dropped`, body: reasonText(row.reason) ?? "It failed on-chain checks too often.", actionable: false });
    }
  }
  return out;
}
