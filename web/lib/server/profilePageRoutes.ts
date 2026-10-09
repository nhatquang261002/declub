import { isAddress } from "viem";
import type { AvatarView } from "../avatars";
import { cleanAbout, type About, type WalletClub, type WalletProfile } from "../about";
import { linkedEthereumWallets, profileKey, type StoredProfile } from "../profiles";
import { ownedAbout, readAbout, setAbout, syncAbout } from "./about";
import { registry as defaultRegistry, type Registry } from "../verifiedAssets";
import { readAvatars } from "./avatars";
import { fail, gateUser, json, type UserGate } from "./gate";
import { membershipsOfWallet } from "./members";
import { readTrophies } from "./challengeState";
import type { PublicTrophy } from "../challenges";
import { softViewer, type RouteDeps } from "./boardRoutes";
import { listWalletPosts } from "./timeline";
import { pageParams } from "./timelineRoutes";
import { clientId, getStore, withinLimit, type Store } from "./store";

/**
 * The profile page's two routes (ADR 0042): the signed-in user's own name and bio, and a wallet's
 * public profile in one read. What the page shows is only what each owner chose to show: the
 * handle they shared (ADR 0011), the avatar they set (ADR 0028) and the text they wrote.
 */
type ProfilePageDeps = {
  store?: () => Store | null;
  gate?: (request: Request, name: string, limit: number) => Promise<UserGate>;
};

type LinkedAccounts = Parameters<typeof linkedEthereumWallets>[0];

/**
 *   GET   { enabled, about }                        what the caller has written
 *   PUT   { name?, bio? }  →  { enabled, about }    keeps it for every wallet linked to the caller; blank fields clear
 *   (needs the caller's Privy access token; the wallets come from Privy, never from the body)
 */
export function aboutHandlers(deps: ProfilePageDeps = {}) {
  const gate = deps.gate ?? gateUser;
  return {
    async GET(request: Request) {
      const g = await gate(request, "about", 30);
      if (g instanceof Response) return g;
      const wallets = linkedEthereumWallets(g.user.linked_accounts as LinkedAccounts);
      await syncAbout(g.store, g.user.id, wallets);
      const row = await ownedAbout(g.store, g.user.id, wallets);
      return json({ enabled: true, about: { ...(row?.name ? { name: row.name } : {}), ...(row?.bio ? { bio: row.bio } : {}) } satisfies About });
    },

    async PUT(request: Request) {
      const g = await gate(request, "about", 20);
      if (g instanceof Response) return g;
      const text = await request.text();
      if (text.length > 4_000) return fail(413, "too_large", "That is too long for a name and a bio.");
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return fail(400, "bad_request", "Send a name and a bio.");
      }
      const cleaned = cleanAbout(body);
      if (!cleaned.ok) return fail(422, "invalid", cleaned.message);
      const wallets = linkedEthereumWallets(g.user.linked_accounts as LinkedAccounts);
      const result = await setAbout(g.store, g.user.id, wallets, cleaned.about);
      if (!result.ok) return fail(422, result.reason, "Link a wallet first.");
      return json({ enabled: true, about: result.about });
    },
  };
}

/** Public, but the owner's own page asks for `fresh`, so what they just saved isn't hidden behind the CDN's copy. */
const publicCache = (request: Request) => ({
  headers: { "Cache-Control": new URL(request.url).searchParams.get("fresh") === "1" ? "no-store" : "public, s-maxage=30, stale-while-revalidate=120" },
});

/** The start of a wallet page read: the wallet and the store, or the response that ends the call (bad address, no store, which answers `off`, or too many requests). */
async function walletRead(deps: ProfilePageDeps, request: Request, ctx: { params: Promise<{ address: string }> }, limit: string, off: object) {
  const { address } = await ctx.params;
  if (!isAddress(address, { strict: false })) return fail(400, "bad_request", "Give a wallet address.");
  const store = (deps.store ?? getStore)();
  if (!store) return Response.json(off, { headers: { "Cache-Control": "no-store" } });
  if (!(await withinLimit(store, limit, clientId(request), 240, 60))) return fail(429, "rate_limited", "Too many requests.");
  return { wallet: address.toLowerCase(), store };
}

/** GET /api/wallets/[address]/profile: what a wallet's owner shows about themselves. Public. */
export function walletProfileHandler(deps: ProfilePageDeps & { registry?: Pick<Registry, "clubFor"> } = {}) {
  const clubs = deps.registry ?? defaultRegistry;
  return async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
    const read = await walletRead(deps, request, ctx, "wallet-profile", { enabled: false, profile: null, avatar: null, about: null } satisfies WalletProfile);
    if (read instanceof Response) return read;
    const { wallet, store } = read;
    // Each part is cosmetic: one that can't be read leaves a plainer page, not an error.
    const [row, avatars, about] = await Promise.all([
      store.get<StoredProfile>(profileKey(wallet)).catch(() => null),
      readAvatars(store, [wallet]).catch(() => ({}) as Record<string, AvatarView>),
      readAbout(store, wallet).catch(() => null),
    ]);
    const trophies = await walletTrophies(store, wallet, row, clubs).catch(() => []);
    const body: WalletProfile = {
      enabled: true,
      profile: row ? { provider: row.provider, handle: row.handle } : null,
      avatar: avatars[wallet] ?? null,
      about,
      ...(trophies.length > 0 ? { trophies } : {}),
    };
    return Response.json(body, publicCache(request));
  };
}

/**
 * The challenges `wallet` won (ADR 0050), newest first. Trophies are kept per user; only the ones
 * won under this wallet are shown, so a profile never ties together wallets its owner kept apart.
 */
async function walletTrophies(store: Store, wallet: string, row: StoredProfile | null, clubs: Pick<Registry, "clubFor">): Promise<PublicTrophy[]> {
  const userId = row?.userId ?? (await membershipsOfWallet(store, wallet))[0]?.row.userId;
  if (!userId) return [];
  return (await readTrophies(store, userId)).flatMap(({ wallet: won, ...t }) => {
    const club = clubs.clubFor(t.club);
    return won === wallet && club ? [{ ...t, clubName: club.name }] : [];
  });
}

/**
 * GET /api/wallets/[address]/clubs: the Clubs whose Members list shows this wallet, newest join
 * first. Only the Club, the Holder badge and the join time: what the Members list already says.
 */
export function walletClubsHandler(deps: ProfilePageDeps & { registry?: Pick<Registry, "clubFor"> } = {}) {
  const clubs = deps.registry ?? defaultRegistry;
  return async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
    const read = await walletRead(deps, request, ctx, "wallet-clubs", { enabled: false, clubs: [] });
    if (read instanceof Response) return read;
    const { wallet, store } = read;

    const rows = await membershipsOfWallet(store, wallet);
    const list: WalletClub[] = rows
      // A Club that has left the list isn't shown, as it isn't on the Clubs page.
      .filter(({ token }) => clubs.clubFor(token))
      .map(({ token, row }) => ({ token, holder: row.holder, joinedAt: row.joinedAt }))
      .sort((a, b) => b.joinedAt - a.joinedAt);
    return Response.json({ enabled: true, clubs: list }, publicCache(request));
  };
}

/**
 * GET /api/wallets/[address]/board?limit=&before=   { enabled, posts, next }: the Board posts a
 * wallet wrote, newest first, as the timeline serves them (ADR 0041, 0042), so a profile draws them
 * with the same cards. `before` is the `next` of the page before. Public; a reader who sends a
 * token also gets which posts they liked.
 */
export function walletBoardHandler(registry: Registry = defaultRegistry, deps: ProfilePageDeps & Pick<RouteDeps, "viewer"> = {}) {
  return async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
    const { address } = await ctx.params;
    if (!isAddress(address, { strict: false })) return fail(400, "bad_request", "Give a wallet address.");
    const page = pageParams(new URL(request.url));
    if (page instanceof Response) return page;
    const { limit, before } = page;
    const store = (deps.store ?? getStore)();
    if (!store) return Response.json({ enabled: false, posts: [], next: null }, { headers: { "Cache-Control": "no-store" } });
    if (!(await withinLimit(store, "wallet-board", clientId(request), 120, 60))) return fail(429, "rate_limited", "Too many requests.");

    const viewer = await softViewer(request, deps);
    const { posts, next } = await listWalletPosts(store, registry, address.toLowerCase(), { userId: viewer?.id, before, limit });
    const cache = viewer ? "private, no-store" : "public, s-maxage=15, stale-while-revalidate=60";
    return Response.json({ enabled: true, posts, next }, { headers: { "Cache-Control": cache } });
  };
}
