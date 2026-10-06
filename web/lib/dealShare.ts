import { formatUnits } from "viem";
import { formatMon } from "./format";
import type { Asset, TokenInfo } from "./assets";
import type { DisplayStatus } from "./deals";

/** What a shared deal says about itself: a short title for the link preview, and the post's text. */
export type DealFacts = {
  id: string;
  status: DisplayStatus;
  /** What the maker gives, and what they ask: already worded ("Chog #12, #40", "1.5 MON"). */
  give: string;
  want: string;
  /** An open offer asks nothing: takers send proposals. */
  openOffer: boolean;
};

/** The words for one side: NFTs grouped by collection, then tokens, then MON. */
export function describeAssets(
  assets: readonly Asset[],
  info: ReadonlyMap<string, TokenInfo>,
  nameOf: (token: string) => string | undefined,
): string {
  const parts: string[] = [];
  const nfts = new Map<string, bigint[]>();
  for (const a of assets) {
    const key = a.token.toLowerCase();
    if (a.kind === "erc721") nfts.set(key, [...(nfts.get(key) ?? []), a.id]);
  }
  for (const [token, ids] of nfts) {
    const name = nameOf(token) ?? `${token.slice(0, 6)}…`;
    parts.push(ids.length > 4 ? `${ids.length} ${name}` : `${name} ${ids.map((id) => `#${id}`).join(", ")}`);
  }
  for (const a of assets) {
    if (a.kind === "trait") parts.push(`${a.amount === 1n ? "a" : a.amount} ${nameOf(a.token.toLowerCase()) ?? "NFT"} of a kind`);
    if (a.kind === "erc20") {
      const t = info.get(a.token.toLowerCase());
      parts.push(t ? `${formatUnits(a.amount, t.decimals)} ${t.symbol}` : `${a.token.slice(0, 6)}… tokens`);
    }
    if (a.kind === "native") parts.push(formatMon(a.amount));
  }
  return parts.join(" + ") || "assets";
}

/** The deal in one line, for a link preview's title. */
export function dealTitle(f: DealFacts): string {
  if (f.status === "filled") return f.openOffer ? `Swapped: ${f.give} for an accepted offer` : `Swapped: ${f.give} for ${f.want}`;
  if (f.openOffer) return `Offering ${f.give}, open to offers`;
  return `${f.give} for ${f.want}`;
}

/** A long list of assets shortens, so the post stays inside X's limit with its link. */
const clip = (text: string) => (text.length > 70 ? `${text.slice(0, 69)}…` : text);

/**
 * What a member posts about a deal. A swap that went through is news; a live offer is an invitation,
 * and `club` is the Club's name when the deal's asset has one, so the post is about it too.
 */
export function dealPost(f: DealFacts, club?: string): string {
  const give = clip(f.give);
  const want = clip(f.want);
  const where = club ? `In the ${club} Club on De(al) Club.` : "On De(al) Club.";
  if (f.status === "filled") return `Swapped ${give} for ${f.openOffer ? "an offer I accepted" : want} ✅\n\n${where} Escrowed on Monad, atomic, done.`;
  if (f.status === "open" && f.openOffer) return `Offering ${give}, open to offers 🤝\n\n${where} Escrowed on Monad. Make me an offer 👇`;
  if (f.status === "open") return `Offering ${give} for ${want} 🤝\n\n${where} Escrowed on Monad: both sides or nothing. Take the deal 👇`;
  return `Deal #${f.id}\n\n${where}`;
}

/** The X compose link for a deal post: its text, and the deal's page (whose preview card is the offer). */
export const dealPostLink = (f: DealFacts, dealUrl: string, club?: string) =>
  `https://x.com/intent/post?text=${encodeURIComponent(dealPost(f, club))}&url=${encodeURIComponent(dealUrl)}`;
