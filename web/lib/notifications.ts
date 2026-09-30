import { expiryLabel, formatIds, formatMon } from "./format";
import { displayStatus, sameAddress, type Trade } from "./trades";

export type NotificationKind = "request" | "filled" | "expiring" | "expired";

export type AppNotification = {
  /** Stable per (kind, trade), so read state survives reloads. */
  key: string;
  kind: NotificationKind;
  tradeId: bigint;
  title: string;
  body: string;
  href: string;
  /** Needs a transaction from the user (accept, reclaim), as opposed to informational. */
  actionable: boolean;
};

/** A maker's open trade is "expiring" inside this window. */
export const EXPIRING_WINDOW_SEC = 3_600;

const offerSummary = (trade: Trade) => {
  const parts = [
    trade.offeredIds.length ? formatIds(trade.offeredIds) : null,
    trade.offeredMon > 0n ? formatMon(trade.offeredMon) : null,
  ].filter(Boolean);
  return parts.join(" + ") || "assets";
};

/**
 * What the wallet should hear about, derived from the current trade list. There is no event
 * stream to subscribe to (ADR 0003), so every notification is a pure function of trade state
 * and can be recomputed on any device.
 *
 * - request:  someone sent me a direct offer that is still open
 * - filled:   a trade I made was accepted
 * - expiring: my open trade ends within EXPIRING_WINDOW_SEC
 * - expired:  my open trade ran out; the escrow is still locked until someone reclaims it
 */
export function deriveNotifications(
  trades: readonly Trade[],
  account: string | undefined,
  nowSec: number,
): AppNotification[] {
  if (!account) return [];
  const out: AppNotification[] = [];

  for (const trade of trades) {
    const status = displayStatus(trade, nowSec);
    const href = `/trade/${trade.id}`;
    const mine = sameAddress(trade.maker, account);

    if (!mine && sameAddress(trade.taker, account) && status === "open") {
      out.push({
        key: `request:${trade.id}`,
        kind: "request",
        tradeId: trade.id,
        title: `Direct offer #${trade.id} for you`,
        body: `Offering ${offerSummary(trade)}. ${expiryLabel(trade.expiry, nowSec)}.`,
        href,
        actionable: true,
      });
    }

    if (!mine) continue;

    if (status === "filled") {
      out.push({
        key: `filled:${trade.id}`,
        kind: "filled",
        tradeId: trade.id,
        title: `Trade #${trade.id} was accepted`,
        body: `Your ${offerSummary(trade)} was swapped.`,
        href,
        actionable: false,
      });
    } else if (status === "expired") {
      out.push({
        key: `expired:${trade.id}`,
        kind: "expired",
        tradeId: trade.id,
        title: `Trade #${trade.id} expired`,
        body: "Nobody accepted it. Reclaim your assets from escrow.",
        href,
        actionable: true,
      });
    } else if (status === "open" && trade.expiry !== 0n && Number(trade.expiry) - nowSec <= EXPIRING_WINDOW_SEC) {
      out.push({
        key: `expiring:${trade.id}`,
        kind: "expiring",
        tradeId: trade.id,
        title: `Trade #${trade.id} is about to expire`,
        body: `${expiryLabel(trade.expiry, nowSec)}. Cancel or let it lapse and reclaim.`,
        href,
        actionable: false,
      });
    }
  }

  // Actionable first, then newest trade first.
  return out.sort(
    (a, b) => Number(b.actionable) - Number(a.actionable) || (a.tradeId < b.tradeId ? 1 : -1),
  );
}
