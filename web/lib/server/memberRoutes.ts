import { isAddress } from "viem";
import { linkedEthereumWallets } from "../profiles";
import type { MemberSort } from "../members";
import type { Registry } from "../verifiedAssets";
import { roleIn, type Deps as BoardDeps } from "./board";
import { clubEvents, type Deps } from "./clubs";
import { fail, gateUser, json, type UserGate } from "./gate";
import { clubsOf, getMember, joinClub, leaveClub, listMembers, syncMemberships, type MemberDeps } from "./members";
import { clientId, getStore, withinLimit } from "./store";

/**
 * The Club membership routes, built over a registry like the read routes (lib/server/clubRoutes.ts)
 * so the rules can be tried against a list of their own. The route files bind the shipped one.
 */
export type RouteDeps = Deps &
  MemberDeps &
  BoardDeps & {
    /** Who is calling. Privy in production; a stand-in in tests. */
    gate?: (request: Request, name: string, limit: number) => Promise<UserGate>;
  };

export type Ctx = { params: Promise<{ token: string }> };

/** The Club for `token`, or the response that says why there isn't one. */
export async function clubOf(registry: Registry, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!isAddress(token, { strict: false })) return fail(400, "bad_request", "Give a token address.");
  // Blocked, unlisted and listed-without-a-Club assets all read the same: there is no Club.
  return registry.clubFor(token) ?? fail(404, "not_found", "No Club for this asset.");
}

/** What the signed-in user's own membership looks like to them. */
const mine = (row: { displayWallet: string; holder: boolean; joinedAt: number }, role: string) => ({
  member: true,
  wallet: row.displayWallet,
  holder: row.holder,
  joinedAt: row.joinedAt,
  role,
});

/**
 * GET / POST / DELETE /api/clubs/[token]/membership: the caller's own membership, joining, leaving.
 * Every call needs their Privy access token. Their wallets come from Privy, not the request, and
 * every call re-syncs them, so a wallet unlinked elsewhere stops counting the next time they load.
 */
export function membershipHandlers(registry: Registry, deps: RouteDeps = {}) {
  return {
    async GET(request: Request, ctx: Ctx) {
      const entry = await clubOf(registry, ctx);
      if (entry instanceof Response) return entry;
      const g = await (deps.gate ?? gateUser)(request, "club-member", 60);
      if (g instanceof Response) return g;
      const { store, user } = g;

      await syncMemberships(store, user.id, linkedEthereumWallets(user.linked_accounts));
      const row = await getMember(store, entry.address, user.id);
      const role = await roleIn(store, entry.address, user.id, deps);
      // An admin has staff powers in a Club they never joined, so the page needs to know.
      return json({ enabled: true, ...(row ? mine(row, role) : { member: false, ...(role === "admin" ? { role } : {}) }) });
    },

    async POST(request: Request, ctx: Ctx) {
      const entry = await clubOf(registry, ctx);
      if (entry instanceof Response) return entry;
      const g = await (deps.gate ?? gateUser)(request, "club-join", 20);
      if (g instanceof Response) return g;
      const { store, user } = g;

      const result = await joinClub(store, entry, user.id, linkedEthereumWallets(user.linked_accounts), deps);
      if (result.ok) return json({ enabled: true, ...mine(result.row, await roleIn(store, entry.address, user.id, deps)) });
      if (result.reason === "archived") return fail(409, "archived", "This Club is archived and isn’t taking new members.");
      if (result.reason === "banned") return fail(403, "banned", "You can’t join this Club.");
      if (result.reason === "full") return fail(409, "full", "This Club is full.");
      return fail(422, "no_wallet", "Link a wallet to your account first, so the Club has one to show.");
    },

    async DELETE(request: Request, ctx: Ctx) {
      const entry = await clubOf(registry, ctx);
      if (entry instanceof Response) return entry;
      const g = await (deps.gate ?? gateUser)(request, "club-join", 20);
      if (g instanceof Response) return g;
      // An admin outranks any Club role, so only a real Owner is held back.
      const role = await roleIn(g.store, entry.address, g.user.id, deps);
      if (role === "owner") return fail(409, "owner_cannot_leave", "Hand the Club to another member before you leave.");
      await leaveClub(g.store, entry.address, g.user.id);
      return json({ enabled: true, member: false });
    },
  };
}

const SORTS = new Set<MemberSort>(["momentum", "new"]);

/** GET /api/clubs/[token]/members?sort=momentum|new: the leaderboard. Public. */
export function membersHandler(registry: Registry, deps: RouteDeps = {}) {
  return async function GET(request: Request, ctx: Ctx) {
    const entry = await clubOf(registry, ctx);
    if (entry instanceof Response) return entry;
    const asked = new URL(request.url).searchParams.get("sort") ?? "momentum";
    if (!SORTS.has(asked as MemberSort)) return fail(400, "bad_request", "sort is momentum or new.");

    const store = getStore();
    if (!store) return Response.json({ enabled: false, members: [], total: 0, holders: 0 }, { headers: { "Cache-Control": "no-store" } });
    if (!(await withinLimit(store, "clubs-read", clientId(request), 240, 60))) return fail(429, "rate_limited", "Too many requests.");

    const nowSec = deps.now?.() ?? Math.floor(Date.now() / 1000);
    const events = await clubEvents(store, entry.address, deps);
    const view = await listMembers(store, entry, events, asked as MemberSort, nowSec, deps);
    return Response.json(
      { enabled: true, ...view },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
    );
  };
}

/** GET /api/me/clubs: the Clubs the caller belongs to (only ones that still exist). */
export function myClubsHandler(registry: Registry, deps: Pick<RouteDeps, "gate"> = {}) {
  return async function GET(request: Request) {
    const g = await (deps.gate ?? gateUser)(request, "me-clubs", 60);
    if (g instanceof Response) return g;
    const tokens = await clubsOf(g.store, g.user.id);
    const clubs = tokens.filter((token) => registry.clubFor(token)).sort();
    return json({ enabled: true, clubs });
  };
}
