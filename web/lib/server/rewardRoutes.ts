import { getAddress, isAddress } from "viem";
import { DECLUB_REWARDS_ADDRESS } from "../config";
import { epochAt, epochWindow } from "../rewards";
import type { Registry } from "../verifiedAssets";
import { claimableFor, clubRewards, readEpoch } from "./rewards";
import { clubStandings, standingsView } from "./standings";
import { xApiConfigured } from "./xApi";
import { clientId, getStore, withinLimit, type Store } from "./store";

/**
 * The Club Rewards read routes (ADR 0022). Everything here is public: an epoch's record is what
 * anyone needs to check the root, and a leaf is only useful to the account it pays. Without a
 * store there is nothing to serve, and the screens say Rewards aren't running.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const fail = (status: number, error: string, message: string) =>
  Response.json({ error, message }, { status, headers: NO_STORE });

export type RouteDeps = { store?: () => Store | null; now?: () => number };

const storeOf = (deps: RouteDeps) => (deps.store ?? getStore)();
const nowOf = (deps: RouteDeps) => deps.now?.() ?? Math.floor(Date.now() / 1000);

/** The epoch running now and when it ends, for the countdowns. */
function current(now: number) {
  const n = epochAt(now);
  return { epoch: n, endsAt: n < 0 ? epochWindow(0).start : epochWindow(n).end };
}

async function limited(store: Store, request: Request) {
  return !(await withinLimit(store, "rewards-read", clientId(request), 240, 60));
}

/** GET /api/rewards/epochs/[n]: a built epoch, proofs and all, so anyone can recompute the root. */
export function epochHandler(deps: RouteDeps = {}) {
  return async function GET(request: Request, { params }: { params: Promise<{ n: string }> }) {
    const { n } = await params;
    if (!/^\d{1,9}$/.test(n)) return fail(400, "bad_request", "Give an epoch number.");
    const store = storeOf(deps);
    if (!store) return fail(503, "disabled", "Rewards aren't running on this server.");
    if (await limited(store, request)) return fail(429, "rate_limited", "Too many requests.");
    const record = await readEpoch(store, Number(n));
    if (!record) return fail(404, "not_found", "That epoch hasn't been built.");
    // A built epoch never changes.
    return Response.json(record, { headers: { "Cache-Control": "public, s-maxage=3600, immutable" } });
  };
}

/** GET /api/rewards/me?account=0x…: the account's leaves, newest first, with proofs. */
export function claimableHandler(deps: RouteDeps = {}) {
  return async function GET(request: Request) {
    const account = new URL(request.url).searchParams.get("account") ?? "";
    if (!isAddress(account, { strict: false })) return fail(400, "bad_request", "Give an account address.");
    const store = storeOf(deps);
    const base = { contract: DECLUB_REWARDS_ADDRESS ?? null, ...current(nowOf(deps)) };
    if (!store) return Response.json({ enabled: false, ...base, leaves: [] }, { headers: NO_STORE });
    if (await limited(store, request)) return fail(429, "rate_limited", "Too many requests.");
    const leaves = await claimableFor(store, getAddress(account));
    return Response.json({ enabled: true, ...base, leaves }, { headers: { "Cache-Control": "private, max-age=15" } });
  };
}

/** GET /api/clubs/[token]/rewards: a Club's line in the latest epochs, what rolls over, who earned. */
export function clubRewardsHandler(registry: Registry, deps: RouteDeps = {}) {
  return async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    if (!isAddress(token, { strict: false })) return fail(400, "bad_request", "Give a token address.");
    const entry = registry.clubFor(token);
    if (!entry) return fail(404, "not_found", "No Club for this asset.");
    const store = storeOf(deps);
    // Whether X engagement counts in the Holder bonus (ADR 0024): only with the X API configured.
    const base = { contract: DECLUB_REWARDS_ADDRESS ?? null, ...current(nowOf(deps)), xReach: xApiConfigured() };
    if (!store) return Response.json({ enabled: false, ...base, epochs: [], carry: { holders: "0", fund: "0" }, earners: [] }, { headers: NO_STORE });
    if (await limited(store, request)) return fail(429, "rate_limited", "Too many requests.");
    const view = await clubRewards(store, entry.address, nowOf(deps));
    return Response.json({ enabled: true, ...base, ...view }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  };
}

/**
 * GET /api/clubs/[token]/rewards/standings?wallet=0x…: the running epoch as if it closed now
 * (ADR 0032), with the reader's own place when they give their Club wallet. An estimate, a few
 * minutes old at most.
 */
export function standingsHandler(registry: Registry, deps: RouteDeps & { standings?: typeof clubStandings } = {}) {
  return async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    if (!isAddress(token, { strict: false })) return fail(400, "bad_request", "Give a token address.");
    const entry = registry.clubFor(token);
    if (!entry) return fail(404, "not_found", "No Club for this asset.");
    const wallet = new URL(request.url).searchParams.get("wallet");
    if (wallet && !isAddress(wallet, { strict: false })) return fail(400, "bad_request", "Give a wallet address.");
    const store = storeOf(deps);
    if (!store) return Response.json({ enabled: false, standings: null }, { headers: NO_STORE });
    if (await limited(store, request)) return fail(429, "rate_limited", "Too many requests.");
    const standings = await (deps.standings ?? clubStandings)(store, entry, deps.now ? { now: deps.now } : {});
    const view = standings ? standingsView(standings, wallet ?? undefined) : null;
    // The reader's own place depends on the wallet they asked for, so only the plain view is shared.
    const cache = wallet ? "private, max-age=30" : "public, s-maxage=60, stale-while-revalidate=120";
    return Response.json({ enabled: true, standings: view }, { headers: { "Cache-Control": cache } });
  };
}
