import { isAddress } from "viem";
import { linkedEthereumWallets } from "../profiles";
import { parseFollowMessage, socialDomain, SOCIAL_TYPES } from "../social";
import { walletPosts } from "./board";
import { exportFollows, recordFollow, type FollowDeps } from "./follows";
import { fail, gateUser, json, type UserGate } from "./gate";
import { clientId, getStore, withinLimit, type Store } from "./store";

/**
 * A wallet's portable social records (ADR 0023): its signed posts across Clubs and its follows, and
 * the route that records a follow. Reads are public and keyed by wallet, so they work for anyone,
 * signed in or not, in this app or another.
 */
export type SocialDeps = FollowDeps & {
  store?: () => Store | null;
  gate?: (request: Request, name: string, limit: number) => Promise<UserGate>;
};

type WalletCtx = { params: Promise<{ address: string }> };

const REFUSALS: Record<string, [number, string]> = {
  unsigned: [400, "Sign the follow with your wallet first."],
  not_yours: [403, "Follow from one of the wallets linked to your account."],
  self: [400, "You can’t follow yourself."],
  stale: [400, "That signature is too old, or your clock is off. Sign it again."],
  bad_signature: [401, "The signature doesn’t match that wallet."],
  outdated: [409, "A newer follow or unfollow is already recorded."],
  too_many: [409, "You follow as many wallets as you can. Unfollow some first."],
  rate_limited: [429, "You’ve reached the limit for now. Try again later."],
};

const PUBLIC = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" };

async function readFront(request: Request, ctx: WalletCtx, deps: SocialDeps) {
  const { address } = await ctx.params;
  if (!isAddress(address, { strict: false })) return fail(400, "bad_request", "Give a wallet address.");
  const store = (deps.store ?? getStore)();
  if (!store) return null;
  if (!(await withinLimit(store, "social-read", clientId(request), 240, 60))) return fail(429, "rate_limited", "Too many requests.");
  return { address, store };
}

/** GET /api/wallets/[address]/posts: every signed post the wallet wrote, across Clubs. */
export function walletPostsHandler(deps: SocialDeps = {}) {
  return async function GET(request: Request, ctx: WalletCtx) {
    const f = await readFront(request, ctx, deps);
    if (f instanceof Response) return f;
    if (!f) return Response.json({ enabled: false, posts: [] }, { headers: { "Cache-Control": "no-store" } });
    const posts = await walletPosts(f.store, f.address);
    return Response.json({ enabled: true, domain: socialDomain(), types: { Post: SOCIAL_TYPES.Post }, posts }, { headers: PUBLIC });
  };
}

/** GET /api/wallets/[address]/follows: who the wallet follows, as signed records, and its follower count. */
export function walletFollowsHandler(deps: SocialDeps = {}) {
  return async function GET(request: Request, ctx: WalletCtx) {
    const f = await readFront(request, ctx, deps);
    if (f instanceof Response) return f;
    if (!f) return Response.json({ enabled: false, follows: [], followers: 0 }, { headers: { "Cache-Control": "no-store" } });
    const graph = await exportFollows(f.store, f.address);
    return Response.json({ enabled: true, domain: socialDomain(), types: { Follow: SOCIAL_TYPES.Follow }, ...graph }, { headers: PUBLIC });
  };
}

/** POST /api/follows  { message, signature }: follow or unfollow, signed by one of the caller's wallets. */
export function followHandler(deps: SocialDeps = {}) {
  return async function POST(request: Request) {
    const g = await (deps.gate ?? gateUser)(request, "follow", 60);
    if (g instanceof Response) return g;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const wallets = linkedEthereumWallets(g.user.linked_accounts as Parameters<typeof linkedEthereumWallets>[0]);
    const result = await recordFollow(g.store, g.user.id, wallets, { message: parseFollowMessage(body?.message), signature: body?.signature }, deps);
    if (result.ok) return json({ enabled: true, following: result.following });
    const [status, message] = REFUSALS[result.reason] ?? [400, "That isn’t allowed."];
    return fail(status, result.reason, message);
  };
}
