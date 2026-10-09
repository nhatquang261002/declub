import type { XPostFacts } from "../xPosts";

/**
 * The official X API (ADR 0024), for what oEmbed can't give: a post's reach (likes, reposts, quotes,
 * replies), its full links and who it quotes, and an account's numeric id. Pay per use (about
 * $0.005 a post read), so it is read once per epoch, for the X shares that counted, and only with
 * X_BEARER_TOKEN set. Server only: put the token in web/.env.local.
 */
const token = () => process.env.X_BEARER_TOKEN?.trim() || undefined;

export const xApiConfigured = () => Boolean(token());

const API = "https://api.x.com/2";
const FETCH_TIMEOUT_MS = 15_000;
/** The most ids one /2/tweets call takes. */
const X_IDS_PER_CALL = 100;

type XApiDeps = { fetch?: typeof fetch; token?: string };

/** One post as the reach read needs it. */
export type XApiPost = {
  id: string;
  authorId: string;
  /** Likes + reposts + quotes + replies. */
  engagement: number;
  facts: XPostFacts;
};

async function get(path: string, deps: XApiDeps): Promise<unknown> {
  const bearer = deps.token ?? token();
  if (!bearer) throw new Error("X_BEARER_TOKEN isn't set");
  const res = await (deps.fetch ?? fetch)(`${API}${path}`, {
    headers: { authorization: `Bearer ${bearer}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "error",
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`X API answered ${res.status} for ${path.split("?")[0]}`);
  }
  return res.json();
}

type Raw = {
  data?: {
    id: string;
    author_id: string;
    text: string;
    public_metrics?: Partial<Record<"like_count" | "retweet_count" | "quote_count" | "reply_count", number>>;
    entities?: {
      mentions?: { username: string }[];
      hashtags?: { tag: string }[];
      cashtags?: { tag: string }[];
      urls?: { expanded_url?: string; unwound_url?: string; url?: string }[];
    };
    referenced_tweets?: { type: string; id: string }[];
  }[];
  includes?: { tweets?: { id: string; author_id?: string }[]; users?: { id: string; username: string }[] };
};

const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Reads one answer of /2/tweets into posts by id. Ids X didn't return (deleted, private) are absent. */
export function parsePosts(body: unknown): Map<string, XApiPost> {
  const raw = (body ?? {}) as Raw;
  const authors = new Map((raw.includes?.tweets ?? []).map((t) => [t.id, t.author_id]));
  const usernames = new Map((raw.includes?.users ?? []).map((u) => [u.id, u.username]));
  const out = new Map<string, XApiPost>();
  for (const post of raw.data ?? []) {
    const m = post.public_metrics ?? {};
    const e = post.entities ?? {};
    out.set(post.id, {
      id: post.id,
      authorId: post.author_id,
      engagement: count(m.like_count) + count(m.retweet_count) + count(m.quote_count) + count(m.reply_count),
      facts: {
        text: post.text ?? "",
        mentions: (e.mentions ?? []).map((x) => x.username),
        hashtags: (e.hashtags ?? []).map((x) => x.tag),
        cashtags: (e.cashtags ?? []).map((x) => x.tag),
        urls: (e.urls ?? []).flatMap((x) => [x.unwound_url, x.expanded_url].filter((u): u is string => typeof u === "string")),
        referenced: (post.referenced_tweets ?? [])
          .filter((r) => r.type === "quoted" || r.type === "replied_to")
          .map((r) => {
            const id = authors.get(r.id);
            const username = id ? usernames.get(id) : undefined;
            return { ...(id ? { id } : {}), ...(username ? { username } : {}) };
          }),
      },
    });
  }
  return out;
}

/** The posts `ids` names, in calls of 100. Throws when X can't be read, so an epoch isn't built on a gap. */
export async function fetchXPosts(ids: readonly string[], deps: XApiDeps = {}): Promise<Map<string, XApiPost>> {
  const out = new Map<string, XApiPost>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += X_IDS_PER_CALL) {
    const batch = unique.slice(i, i + X_IDS_PER_CALL);
    const query = new URLSearchParams({
      ids: batch.join(","),
      "tweet.fields": "author_id,public_metrics,entities,referenced_tweets",
      expansions: "referenced_tweets.id,referenced_tweets.id.author_id",
      "user.fields": "username",
    });
    for (const [id, post] of parsePosts(await get(`/tweets?${query}`, deps))) out.set(id, post);
  }
  return out;
}

/** X's numeric id for a handle, or `null` without the API or when the handle doesn't exist. */
export async function xUserIdOf(handle: string, deps: XApiDeps = {}): Promise<string | null> {
  if (!(deps.token ?? token())) return null;
  try {
    const body = (await get(`/users/by/username/${encodeURIComponent(handle)}`, deps)) as { data?: { id?: unknown } };
    return typeof body.data?.id === "string" ? body.data.id : null;
  } catch {
    return null;
  }
}
