import { expiryLabel, formatIds, formatMon } from "./format";
import { displayStatus, sameAddress, type Deal } from "./deals";

export type NotificationKind = "request" | "filled" | "expiring" | "expired";

export type AppNotification = {
  /** Stable per (kind, deal), so read state survives reloads. */
  key: string;
  kind: NotificationKind;
  dealId: bigint;
  title: string;
  body: string;
  href: string;
  /** Needs a transaction from the user (accept, reclaim), as opposed to informational. */
  actionable: boolean;
};

/** A maker's open deal is "expiring" inside this window. */
export const EXPIRING_WINDOW_SEC = 3_600;

const offerSummary = (deal: Deal) => {
  const parts = [
    deal.offeredIds.length ? formatIds(deal.offeredIds) : null,
    deal.offeredMon > 0n ? formatMon(deal.offeredMon) : null,
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
  deals: readonly Deal[],
  account: string | undefined,
  nowSec: number,
): AppNotification[] {
  if (!account) return [];
  const out: AppNotification[] = [];

  for (const deal of deals) {
    const status = displayStatus(deal, nowSec);
    const href = `/deal/${deal.id}`;
    const mine = sameAddress(deal.maker, account);

    if (!mine && sameAddress(deal.taker, account) && status === "open") {
      out.push({
        key: `request:${deal.id}`,
        kind: "request",
        dealId: deal.id,
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
        dealId: deal.id,
        title: `Deal #${deal.id} was accepted`,
        body: `Your ${offerSummary(deal)} was swapped.`,
        href,
        actionable: false,
      });
    } else if (status === "expired") {
      out.push({
        key: `expired:${deal.id}`,
        kind: "expired",
        dealId: deal.id,
        title: `Deal #${deal.id} expired`,
        body: "Nobody accepted it. Reclaim your assets from escrow.",
        href,
        actionable: true,
      });
    } else if (status === "open" && deal.expiry !== 0n && Number(deal.expiry) - nowSec <= EXPIRING_WINDOW_SEC) {
      out.push({
        key: `expiring:${deal.id}`,
        kind: "expiring",
        dealId: deal.id,
        title: `Deal #${deal.id} is about to expire`,
        body: `${expiryLabel(deal.expiry, nowSec)}. Cancel or let it lapse and reclaim.`,
        href,
        actionable: false,
      });
    }
  }

  // Actionable first, then newest deal first.
  return out.sort(
    (a, b) => Number(b.actionable) - Number(a.actionable) || (a.dealId < b.dealId ? 1 : -1),
  );
}
