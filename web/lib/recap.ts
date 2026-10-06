import { formatMon } from "./format";

/** What a Club's weekly recap says, for a Holder to post on X. Amounts are wei. */
export type Recap = { symbol: string; epoch: number; fees: bigint; paidHolders: bigint; holderCount: number };

/** The recap's text, without the link (X adds that), always a short post. */
export function recapText(r: Recap): string {
  const holders = r.holderCount === 1 ? "Holder" : "Holders";
  const paid = r.paidHolders > 0n ? ` ${formatMon(r.paidHolders)} went to its ${r.holderCount} biggest ${holders}.` : "";
  return `${r.symbol} Club, epoch ${r.epoch}: ${formatMon(r.fees)} in swap fees.${paid} Own it, post about it, get paid.`;
}

/** The X compose link for the recap: its text, and the Club's page, which makes the post about the Club. */
export function recapLink(r: Recap, clubUrl: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(recapText(r))}&url=${encodeURIComponent(clubUrl)}`;
}
