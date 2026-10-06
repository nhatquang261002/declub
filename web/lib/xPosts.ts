/**
 * X posts on a Club's Board (ADR 0024, docs/09-clubs.md#x-posts). Pure, so the server, the screens
 * and the tests share one reading of an X link, one set of Club signals and one matching rule.
 *
 * A member may share any public X post as a card. It counts toward Momentum and the Holder bonus
 * only when it is their own and it is about the Club, which is what the Club's signals decide.
 */

/** X post ids are 64-bit numbers; a shared link is one of these. */
const X_ID = /^\d{1,19}$/;
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const STATUS_URL = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:i\/(?:web\/)?|[A-Za-z0-9_]{1,15}\/)status(?:es)?\/(\d{1,19})(?:[/?#].*)?$/i;

/** The post id in an x.com or twitter.com post link, or `null` for anything else. */
export function parseXStatus(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const match = STATUS_URL.exec(input.trim());
  if (!match) return null;
  const id = BigInt(match[1]!);
  return id > 0n && id < 2n ** 63n ? id.toString() : null;
}

/** The canonical link a post signs: readable in the wallet prompt, and right whatever the handle. */
export const xStatusUrl = (id: string) => `https://x.com/i/status/${id}`;

/** X's epoch for post ids (2010-11-04): every id since then carries its own creation time. */
const SNOWFLAKE_EPOCH_MS = 1_288_834_974_657n;

/** When the post was made (epoch ms), read from its id, or `null` for an id older than X's ids carry. */
export function postedAtOf(id: string): number | null {
  if (!X_ID.test(id)) return null;
  const ms = (BigInt(id) >> 22n) + SNOWFLAKE_EPOCH_MS;
  // Ids before late 2010 were plain counters and carry no time.
  return BigInt(id) < 2n ** 32n ? null : Number(ms);
}

export const isXHandle = (value: unknown): value is string => typeof value === "string" && X_HANDLE.test(value);

/** The card a shared X post shows. `own`: it was posted by the member's linked X account. */
export type XCard = {
  id: string;
  /** The author's handle, without the @. */
  author: string;
  /** The post's text as plain text, at most `X_CARD_TEXT_MAX` characters. */
  text: string;
  /** Epoch ms, from the id; `null` for the oldest ids. */
  postedAt: number | null;
  /** The post's first photo (or a video's poster), an https://pbs.twimg.com/ URL; absent when it has none. */
  image?: string;
};

/** Only X's own image host is ever drawn, whatever a stored card says. */
export const isXImage = (value: unknown): value is string => typeof value === "string" && /^https:\/\/pbs\.twimg\.com\/[\w./~-]{1,200}$/.test(value);

export const X_CARD_TEXT_MAX = 400;

// ─────────────────────────────────────────────────────────────── a Club's signals

/** A project X account the Owner linked by a proof post. */
export type XAccount = {
  handle: string;
  /** The post that proved it, kept so anyone can look. */
  proof: string;
  /** Epoch ms. */
  linkedAt: number;
  /** X's numeric user id, when the X API was there to read it: it survives a rename. */
  xUserId?: string;
};

export const MAX_X_ACCOUNTS = 3;
export const MAX_X_TAGS = 10;

/** A tag the Owner sets: a hashtag (`#chog`), a cashtag (`$CHOG`) or a plain keyword (`chogs`). */
const TAG = /^([#$]?)([\p{L}\p{N}_]{2,30})$/u;

/** A tag in the form it is stored and matched: trimmed, lowercase, `#`/`$` kept. `null` if it isn't one. */
export function normalizeTag(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const match = TAG.exec(input.trim());
  return match ? `${match[1]}${match[2]!.toLowerCase()}` : null;
}

/** Everything a post is checked against. Addresses, handles and tags are lowercase. */
export type ClubSignals = {
  /** The Club's asset addresses: one in the text or a link is the Club's own name for itself. */
  tokens: string[];
  /** The linked project accounts. */
  accounts: { handle: string; xUserId?: string }[];
  /** Built in (`$SYMBOL` of each asset) and the Owner's. */
  tags: string[];
};

export function clubSignals(
  assets: readonly { address: string; symbol: string }[],
  x: { accounts: readonly XAccount[]; tags: readonly string[] } | undefined,
): ClubSignals {
  const builtIn = assets.flatMap((a) => {
    const tag = normalizeTag(`$${a.symbol}`);
    return tag ? [tag] : [];
  });
  return {
    tokens: assets.map((a) => a.address.toLowerCase()),
    accounts: (x?.accounts ?? []).map((a) => ({ handle: a.handle.toLowerCase(), ...(a.xUserId ? { xUserId: a.xUserId } : {}) })),
    tags: [...new Set([...builtIn, ...(x?.tags ?? [])])],
  };
}

/** What a post says, as far as the signals care. From the oEmbed text, or the X API's entities. */
export type XPostFacts = {
  text: string;
  /** Handles it mentions, without @. */
  mentions?: string[];
  hashtags?: string[];
  cashtags?: string[];
  /** Full URLs it links (the X API expands them; oEmbed only shows them shortened). */
  urls?: string[];
  /** The authors of the posts it quotes or replies to. */
  referenced?: { id?: string; username?: string }[];
};

export type SignalStrength = "strong" | "weak";

const WORD = /[\p{L}\p{N}_]/u;

/** Whether `word` (lowercase) stands alone in `text`: `chog` is in "gm chog!", not in "chogger". */
function hasWord(text: string, word: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(word, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : text[at - 1]!;
    const after = text[at + word.length] ?? "";
    if (!WORD.test(before) && !WORD.test(after)) return true;
    from = at + 1;
  }
}

/** The handles, hashtags and cashtags written in a text, lowercase. */
function written(text: string) {
  const all = (re: RegExp) => [...text.matchAll(re)].map((m) => m[1]!.toLowerCase());
  return {
    mentions: all(/(?:^|[^\w@])@([A-Za-z0-9_]{1,15})/g),
    hashtags: all(/(?:^|[^\p{L}\p{N}_#])#([\p{L}\p{N}_]+)/gu),
    cashtags: all(/(?:^|[^\w$])\$([A-Za-z][A-Za-z0-9_]{0,19})/g),
  };
}

/**
 * Whether a post is about the Club, and how strongly. Strong: it names the Club's asset address or
 * links its Club page, mentions a linked project account, or quotes or replies to one. Weak: only a
 * tag matches. A yes or no per post: ten tags count as much as one.
 */
export function matchSignals(signals: ClubSignals, post: XPostFacts): SignalStrength | null {
  const text = post.text.toLowerCase();
  const seen = written(post.text);
  const urls = (post.urls ?? []).map((u) => u.toLowerCase());

  if (signals.tokens.some((t) => text.includes(t) || urls.some((u) => u.includes(t)))) return "strong";

  const mentions = new Set([...seen.mentions, ...(post.mentions ?? []).map((m) => m.toLowerCase())]);
  for (const account of signals.accounts) {
    if (mentions.has(account.handle)) return "strong";
    const quoted = (post.referenced ?? []).some(
      (r) => (account.xUserId && r.id === account.xUserId) || r.username?.toLowerCase() === account.handle,
    );
    if (quoted) return "strong";
  }

  const hashtags = new Set([...seen.hashtags, ...(post.hashtags ?? []).map((h) => h.toLowerCase())]);
  const cashtags = new Set([...seen.cashtags, ...(post.cashtags ?? []).map((c) => c.toLowerCase())]);
  for (const tag of signals.tags) {
    if (tag.startsWith("#") ? hashtags.has(tag.slice(1)) : tag.startsWith("$") ? cashtags.has(tag.slice(1)) : hasWord(text, tag)) {
      return "weak";
    }
  }
  return null;
}

/** How much a share counts for its strength. */
export const strengthFactor = (strength: SignalStrength | null) => (strength === "strong" ? 1 : strength === "weak" ? 0.5 : 0);

/** What counts, for the composer's hint: "links this Club, mentions @ChogNFT, or uses #chog / $CHOG". */
export function signalsHint(signals: ClubSignals): string {
  const parts = ["links this Club or its token"];
  if (signals.accounts.length > 0) parts.push(`mentions ${signals.accounts.map((a) => `@${a.handle}`).join(" / ")}`);
  // Cashtags read as tickers: $MCHOG. Matching ignores case either way.
  if (signals.tags.length > 0) parts.push(`uses ${signals.tags.map((t) => (t.startsWith("$") ? t.toUpperCase() : t)).join(" / ")}`);
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")}, or ${parts.at(-1)}`;
}
