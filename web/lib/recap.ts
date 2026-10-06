import { formatEther } from "viem";

/** What a Club's weekly recap says, for a Holder to post on X. Amounts are wei. */
export type Recap = { symbol: string; epoch: number; fees: bigint; paidHolders: bigint; holderCount: number };

/** An amount for a post: two decimals at most, so `0.1249 MON` reads as `0.12 MON`. */
export function short(wei: bigint): string {
  if (wei > 0n && wei < 10n ** 16n) return "<0.01 MON";
  const [whole, frac = ""] = formatEther(wei).split(".");
  const cents = frac.slice(0, 2).replace(/0+$/, "");
  return `${whole}${cents ? `.${cents}` : ""} MON`;
}

/** The recap's text, without the link (X adds that), always a short post. */
export function recapText(r: Recap): string {
  const outro = "Hold it. Post about it. Get paid.";
  if (r.paidHolders > 0n) {
    const who = r.holderCount === 1 ? "its biggest Holder" : `its ${r.holderCount} biggest Holders`;
    return `${r.symbol} Club just paid ${who} ${short(r.paidHolders)} 💸\n\n${short(r.fees)} in swap fees this week, split by the NFTs they hold.\n\n${outro}`;
  }
  if (r.fees > 0n) return `${r.symbol} Club made ${short(r.fees)} in swap fees this week 📈\n\n${outro}`;
  return `A quiet week for the ${r.symbol} Club. Be the first to swap next week.\n\n${outro}`;
}

/** The X compose link for the recap: its text, and the Club's page, which makes the post about the Club. */
export function recapLink(r: Recap, clubUrl: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(recapText(r))}&url=${encodeURIComponent(clubUrl)}`;
}
