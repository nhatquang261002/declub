import { getAddress, isAddress, type Address } from "viem";
import { toAsset, type Asset, type TokenInfo } from "./assets";
import { DEFAULT_FILTERS, type DealFilters, type DealSort, type MonFilter } from "./dealFilters";
import { applyDealFilters, involvesToken } from "./dealFilters";
import { isExpired, sameAddress, type DealStatus } from "./deals";
import type { Deal } from "./deals";
import { intentAsListing, intentToWire, parsePoolIntent, wireAsset, type PoolIntent, type SignedListing, type WireAsset } from "./intents";

/**
 * The deal book, filtered on the server (`GET /api/deals`) instead of over the newest 200 deals a
 * browser could read. This file is the part both sides share: the query, the filtering and paging
 * the server runs over the whole book, and the JSON a page of it travels as.
 */

export type DealTab = "open" | "for-you" | "all";
/** Which settlement to show: both, deals with locked assets, or signed swaps (ADR 0008). */
export type BookKind = "any" | "locked" | "signed";
type Listing = Deal | SignedListing;

export type BookQuery = {
  tab: DealTab;
  filters: DealFilters;
  kind: BookKind;
  /** The connected wallet: private offers addressed to it are open to it, and "for-you" is its. */
  viewer?: Address;
  /** Only listings that give or ask for one of these tokens (a Club's market). */
  tokens: Address[];
  /** 1-based. */
  page: number;
  size: number;
};

export const MAX_PAGE_SIZE = 50;
/** A Club has its own asset and at most one paired with it (lib/verifiedAssets.ts). */
const MAX_TOKENS = 2;
const MAX_QUERY = 100;

const TABS: readonly DealTab[] = ["open", "for-you", "all"];
const KINDS: readonly BookKind[] = ["any", "locked", "signed"];
const MONS: readonly MonFilter[] = ["any", "offers-mon", "wants-mon", "no-mon"];
const SORTS: readonly DealSort[] = ["newest", "ending-soon"];

/** The query string for a page. Defaults are left out, so equal queries share a cache entry. */
export function bookParams(q: BookQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.tab !== "open") p.set("tab", q.tab);
  if (q.filters.query.trim()) p.set("q", q.filters.query.trim());
  if (q.filters.mon !== "any") p.set("mon", q.filters.mon);
  if (q.filters.sort !== "newest") p.set("sort", q.filters.sort);
  if (q.kind !== "any") p.set("kind", q.kind);
  if (q.viewer) p.set("viewer", q.viewer.toLowerCase());
  for (const token of q.tokens) p.append("token", token.toLowerCase());
  if (q.page !== 1) p.set("page", String(q.page));
  p.set("size", String(q.size));
  return p;
}

const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T | null =>
  value === null ? fallback : (allowed as readonly string[]).includes(value) ? (value as T) : null;

const count = (value: string | null, fallback: number, max: number) =>
  value === null ? fallback : /^[1-9][0-9]{0,6}$/.test(value) && Number(value) <= max ? Number(value) : null;

/** Reads a request's query string. A string is what was wrong with it. */
export function parseBookQuery(p: URLSearchParams): BookQuery | string {
  const tab = pick(p.get("tab"), TABS, "open");
  const kind = pick(p.get("kind"), KINDS, "any");
  const mon = pick(p.get("mon"), MONS, DEFAULT_FILTERS.mon);
  const sort = pick(p.get("sort"), SORTS, DEFAULT_FILTERS.sort);
  if (!tab || !kind || !mon || !sort) return "Unknown tab, kind, mon or sort.";
  const query = p.get("q") ?? "";
  if (query.length > MAX_QUERY) return `Search for at most ${MAX_QUERY} characters.`;
  const viewer = p.get("viewer");
  if (viewer !== null && !isAddress(viewer, { strict: false })) return "viewer isn't an address.";
  const tokens = p.getAll("token");
  if (tokens.length > MAX_TOKENS || !tokens.every((t) => isAddress(t, { strict: false }))) {
    return `Give at most ${MAX_TOKENS} token addresses.`;
  }
  const page = count(p.get("page"), 1, 1_000_000);
  const size = count(p.get("size"), 10, MAX_PAGE_SIZE);
  if (page === null || size === null) return `page is a positive number, size at most ${MAX_PAGE_SIZE}.`;
  return {
    tab,
    kind,
    filters: { query, mon, sort },
    viewer: viewer === null ? undefined : getAddress(viewer),
    tokens: tokens.map((t) => getAddress(t)),
    page,
    size,
  };
}

/** What the server filters: the whole locked book, newest first, and the pool's signed swaps. */
export type BookSource = {
  deals: readonly Deal[];
  /** Live signed swaps, newest first. */
  openSigned: readonly SignedListing[];
  /** Signed swaps of every status, for the "all" tab. */
  allSigned: readonly SignedListing[];
  /** Token symbols, so a search for "USDC" finds the deals that hold it. */
  info: ReadonlyMap<string, TokenInfo>;
};

type BookResult = {
  items: Listing[];
  /** Listings in the chosen tab that match, over every page. */
  total: number;
  /** The same count for the two tabs that show one. */
  counts: { open: number; forYou: number };
};

const isLive = (t: Listing, now: number) => t.status === "open" && !isExpired(t, now);

/** One page of the book, with the same tabs, search, filters and sorting the deals page offers. */
export function pageBook(source: BookSource, q: BookQuery, now: number): BookResult {
  const locked = q.kind !== "signed" ? source.deals : [];
  const signed = (list: readonly SignedListing[]) => (q.kind !== "locked" ? list : []);
  const forToken = (t: Listing) => q.tokens.length === 0 || q.tokens.some((token) => involvesToken(t, token));
  const filter = (list: Listing[]) => applyDealFilters(list.filter(forToken), q.filters, now, source.info);

  // Signed swaps first: they carry no timestamp or id to order them against deals by, and
  // "Ending soon" re-sorts the two together anyway.
  const live = filter([...signed(source.openSigned), ...locked]).filter((t) => isLive(t, now));
  // Public offers plus private ones addressed to the viewer. A signed swap is open to anyone.
  const open = live.filter((t) => !t.taker || sameAddress(t.taker, q.viewer));
  // Only a locked deal can be addressed to one wallet.
  const forYou = q.viewer ? live.filter((t) => sameAddress(t.taker, q.viewer)) : [];
  const list = q.tab === "open" ? open : q.tab === "for-you" ? forYou : filter([...signed(source.allSigned), ...locked]);

  const start = (q.page - 1) * q.size;
  return { items: list.slice(start, start + q.size), total: list.length, counts: { open: open.length, forYou: forYou.length } };
}

// ─────────────────────────────────────────────────────────────── The JSON

type WireDeal = {
  id: string;
  maker: Address;
  taker: Address | null;
  expiry: string;
  status: DealStatus;
  fee: string;
  offered: WireAsset[];
  requested: WireAsset[];
};
/** A signed swap travels as the pool's own row, so the browser re-checks its hash as for the pool. */
export type WireListing = { deal: WireDeal } | { signed: unknown };

export type BookResponse =
  | { enabled: false }
  | {
      enabled: true;
      items: WireListing[];
      total: number;
      counts: { open: number; forYou: number };
      /** Why the signed swaps are missing, when the pool couldn't be read. Locked deals still are. */
      signedError: string | null;
    };

const wirePoolIntent = (row: PoolIntent) => ({ ...row, intent: intentToWire(row.intent) });

export function toWireListing(t: Listing): WireListing {
  if ("signed" in t) return { signed: wirePoolIntent(t.signed) };
  return {
    deal: {
      id: t.id.toString(),
      maker: t.maker,
      taker: t.taker,
      expiry: t.expiry.toString(),
      status: t.status,
      fee: t.fee.toString(),
      offered: t.offered.map(wireAsset),
      requested: t.requested.map(wireAsset),
    },
  };
}

const STATUSES: ReadonlySet<string> = new Set<DealStatus>(["open", "filled", "cancelled"]);
const uint = (v: unknown) => (typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v) ? BigInt(v) : null);

function fromWireAsset(v: WireAsset): Asset | null {
  const id = uint(v?.id);
  const amount = uint(v?.amount);
  if (id === null || amount === null || typeof v.assetType !== "number" || !isAddress(v.token)) return null;
  return toAsset({ assetType: v.assetType, token: getAddress(v.token), id, amount });
}

function fromWireDeal(v: WireDeal): Deal | null {
  const id = uint(v?.id);
  const expiry = uint(v?.expiry);
  const fee = uint(v?.fee);
  if (id === null || expiry === null || fee === null || !STATUSES.has(v.status) || !isAddress(v.maker)) return null;
  if (v.taker !== null && !isAddress(v.taker)) return null;
  if (!Array.isArray(v.offered) || !Array.isArray(v.requested)) return null;
  const offered = v.offered.map(fromWireAsset);
  const requested = v.requested.map(fromWireAsset);
  if (offered.includes(null) || requested.includes(null)) return null;
  return {
    id,
    maker: getAddress(v.maker),
    taker: v.taker && getAddress(v.taker),
    expiry,
    status: v.status,
    fee,
    offered: offered as Asset[],
    requested: requested as Asset[],
  };
}

/** A page's listings, leaving out any that don't read back. */
export function fromWireListings(items: readonly WireListing[]): Listing[] {
  return items.flatMap((item): Listing[] => {
    if ("signed" in item) {
      const row = parsePoolIntent(item.signed);
      return row ? [intentAsListing(row)] : [];
    }
    const deal = fromWireDeal(item.deal);
    return deal ? [deal] : [];
  });
}
