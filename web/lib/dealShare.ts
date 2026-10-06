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
  /** The Club of the first asset in the deal that has one: the card and the post say so. */
  club?: string;
  /** The Club's art, a path under `public/`, for the card's avatar. */
  clubImage?: string;
  /** Each side's assets as pictures; an open offer asks for none. */
  giveItems?: CardItem[];
  wantItems?: CardItem[];
};

/** One asset of a deal, for the preview card to draw as its own picture. */
export type CardItem = {
  /** The collection's or token's name: "Chog Genesis", "mUSD", "MON". */
  name: string;
  /** An NFT's id ("#4"), or "ANY" for one of a kind. */
  id?: string;
  /** A token's amount, already worded ("1.5"). */
  amount?: string;
  native?: boolean;
  /** Art the app ships under `public/`: the collection's, when it has one. */
  image?: string;
};

/** The assets of one side as pictures: an NFT each, then a token or MON each. */
export function cardItems(
  assets: readonly Asset[],
  info: ReadonlyMap<string, TokenInfo>,
  entryOf: (token: string) => { name: string; image?: string } | null | undefined,
): CardItem[] {
  const nfts: CardItem[] = [];
  const rest: CardItem[] = [];
  for (const a of assets) {
    const entry = entryOf(a.token.toLowerCase());
    const name = entry?.name ?? `${a.token.slice(0, 6)}…`;
    if (a.kind === "erc721") nfts.push({ name, id: `#${a.id}`, image: entry?.image });
    if (a.kind === "trait") nfts.push({ name, id: a.amount === 1n ? "ANY" : `ANY ×${a.amount}`, image: entry?.image });
    if (a.kind === "erc20") {
      const t = info.get(a.token.toLowerCase());
      rest.push({ name: t?.symbol ?? name, amount: t ? formatUnits(a.amount, t.decimals) : undefined, image: entry?.image });
    }
    if (a.kind === "native") rest.push({ name: "MON", amount: formatMon(a.amount).replace(/ MON$/, ""), native: true });
  }
  return [...nfts, ...rest];
}

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
  const where = club ? `In the ${club} Club on DeClub.` : "On DeClub.";
  if (f.status === "filled") return `Swapped ${give} for ${f.openOffer ? "an offer I accepted" : want} ✅\n\n${where} Escrowed on Monad, atomic, done.`;
  if (f.status === "open" && f.openOffer) return `Offering ${give}, open to offers 🤝\n\n${where} Escrowed on Monad. Make me an offer 👇`;
  if (f.status === "open") return `Offering ${give} for ${want} 🤝\n\n${where} Escrowed on Monad: both sides or nothing. Take the deal 👇`;
  return `Deal #${f.id}\n\n${where}`;
}

/** The X compose link for a deal post: its text, and the deal's page (whose preview card is the offer). */
export const dealPostLink = (f: DealFacts, dealUrl: string, club?: string) =>
  `https://x.com/intent/post?text=${encodeURIComponent(dealPost(f, club))}&url=${encodeURIComponent(dealUrl)}`;
