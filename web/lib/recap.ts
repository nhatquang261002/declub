import { formatEther } from "viem";

/** What a Club's weekly recap says, for a Holder to post on X. Amounts are wei. */
export type Recap = { symbol: string; epoch: number; fees: bigint; paidHolders: bigint; holderCount: number; sponsored?: bigint; sponsors?: readonly string[] };

/** An amount for a post: two decimals at most, so `0.1249 MON` reads as `0.12 MON`. */
export function short(wei: bigint): string {
  if (wei > 0n && wei < 10n ** 16n) return "<0.01 MON";
  const [whole, frac = ""] = formatEther(wei).split(".");
  const cents = frac.slice(0, 2).replace(/0+$/, "");
  return `${whole}${cents ? `.${cents}` : ""} MON`;
}

/** "Sponsored by A and B", "A, B and 2 more", or "" when nothing was sponsored (ADR 0035). */
function sponsoredLine(r: Recap): string {
  if (!r.sponsored || r.sponsored <= 0n) return "";
  // Names are kept short here so the post stays within X's limit however long a sponsor's is.
  const names = (r.sponsors ?? []).map((n) => (n.length > 20 ? `${n.slice(0, 19).trimEnd()}…` : n));
  const by =
    names.length === 0
      ? ""
      : names.length === 1
        ? ` by ${names[0]}`
        : names.length === 2
          ? ` by ${names[0]} and ${names[1]}`
          : ` by ${names[0]}, ${names[1]} and ${names.length - 2} more`;
  return `\n\n🎁 ${short(r.sponsored)} sponsored${by}`;
}

/** The recap's text, without the link (X adds that), always a short post. */
export function recapText(r: Recap): string {
  const outro = "Hold it. Post about it. Get paid.";
  if (r.paidHolders > 0n) {
    const who = r.holderCount === 1 ? "its most active Holder" : `its ${r.holderCount} most active Holders`;
    return `${r.symbol} Club just paid ${who} ${short(r.paidHolders)} 💸\n\n${short(r.fees)} in swap fees this week, split by the NFTs they hold.${sponsoredLine(r)}\n\n${outro}`;
  }
  if (r.fees > 0n) return `${r.symbol} Club made ${short(r.fees)} in swap fees this week 📈\n\n${outro}`;
  return `A quiet week for the ${r.symbol} Club. Be the first to swap next week.\n\n${outro}`;
}

/** The X compose link for the recap: its text, and the Club's page, which makes the post about the Club. */
export function recapLink(r: Recap, clubUrl: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(recapText(r))}&url=${encodeURIComponent(clubUrl)}`;
}
