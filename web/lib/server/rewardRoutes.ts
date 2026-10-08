import { getAddress, isAddress } from "viem";
import { DECLUB_REWARDS_ADDRESS } from "../config";
import { epochAt, epochWindow } from "../rewards";
import type { Registry } from "../verifiedAssets";
import { backingRecordKey, type PublishedBacking } from "./backing";
import { claimableFor, clubRewards, pointsKey, readEpoch, type PublishedLedger } from "./rewards";
import { clubStandings, standingsView } from "./standings";
import { xApiConfigured } from "./xApi";
import { clientId, getStore, withinLimit, type Store } from "./store";

/**
 * The Club Rewards read routes (ADR 0022). Everything here is public: an epoch's record is what
 * anyone needs to check the root, and a leaf is only useful to the account it pays. Without a
 * store there is nothing to serve, and the screens say Rewards aren't running.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const fail = (status: number, error: string, message: string) => Response.json({ error, message }, { status, headers: NO_STORE });

type RouteDeps = { store?: () => Store | null; now?: () => number };

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

/** The start of an epoch read: the epoch number and the store, or the response that ends the call (bad number, no store, or too many requests). */
async function epochRead(deps: RouteDeps, request: Request, params: { n: string }) {
  if (!/^\d{1,9}$/.test(params.n)) return fail(400, "bad_request", "Give an epoch number.");
  const store = storeOf(deps);
  if (!store) return fail(503, "disabled", "Rewards aren't running on this server.");
  if (await limited(store, request)) return fail(429, "rate_limited", "Too many requests.");
  return { n: Number(params.n), store };
}

/** The Club for the `token` in the route, or the response that says why there isn't one. */
async function clubIn(registry: Registry, params: Promise<{ token: string }>) {
  const { token } = await params;
  if (!isAddress(token, { strict: false })) return fail(400, "bad_request", "Give a token address.");
  return registry.clubFor(token) ?? fail(404, "not_found", "No Club for this asset.");
}

/** GET of one built epoch's document: `load` reads it, `serve` shapes what is sent, `missing` says why there is none. A built epoch never changes. */
function epochDocHandler<R>(deps: RouteDeps, missing: string, load: (store: Store, n: number) => Promise<R | null>, serve: (n: number, record: R) => unknown) {
  return async function GET(request: Request, { params }: { params: Promise<{ n: string }> }) {
    const read = await epochRead(deps, request, await params);
    if (read instanceof Response) return read;
    const { n, store } = read;
    const record = await load(store, n);
    if (!record) return fail(404, "not_found", missing);
    return Response.json(serve(n, record), { headers: { "Cache-Control": "public, s-maxage=3600, immutable" } });
  };
}

/** GET /api/rewards/epochs/[n]: a built epoch, proofs and all, so anyone can recompute the root. */
export const epochHandler = (deps: RouteDeps = {}) => epochDocHandler(deps, "That epoch hasn't been built.", readEpoch, (_, record) => record);

/**
 * GET /api/rewards/epochs/[n]/backing: who backed whom in a built epoch, by Club and public wallet
 * (ADR 0040): every like and reply that counted, the voices they were given with, and what a
 * moderator's hide removed. With the epoch's rules, anyone can recompute each Holder's points.
 */
export const epochBackingHandler = (deps: RouteDeps = {}) =>
  epochDocHandler(
    deps,
    "No backing was published for that epoch.",
    (store, n) => store.get<Record<string, PublishedBacking>>(backingRecordKey(n)),
    (epoch, clubs) => ({ epoch, clubs }),
  );

/**
 * GET /api/rewards/epochs/[n]/points: every Holder's final points in a built epoch, by Club and
 * public wallet, paid or not (ADR 0040), with the rules used and when the inputs were frozen.
 */
export const epochPointsHandler = (deps: RouteDeps = {}) =>
  epochDocHandler(
    deps,
    "No points were published for that epoch.",
    (store, n) => store.get<Record<string, PublishedLedger>>(pointsKey(n)),
    (epoch, clubs) => ({ epoch, clubs }),
  );

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
    const entry = await clubIn(registry, params);
    if (entry instanceof Response) return entry;
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
    const entry = await clubIn(registry, params);
    if (entry instanceof Response) return entry;
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
