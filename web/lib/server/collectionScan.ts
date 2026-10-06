import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { createPublicClient, getAddress, http, parseAbi, type Address, type PublicClient } from "viem";
import { chain } from "../chain";
import { IPFS_GATEWAY, RPC_URL } from "../config";

/**
 * Reads every token's traits from any ERC-721: `totalSupply` (and `tokenByIndex` when the
 * collection has it), then `tokenURI` for each id, then the metadata JSON's `attributes`.
 * Runs on the server so a page load doesn't fetch thousands of URLs from the visitor's browser,
 * and keeps the result in memory so it is done once per collection.
 *
 * The trade's trust doesn't rest on this: the taker's client rebuilds the same set and compares
 * roots (lib/traitSpec.ts). A differing result just means the deal can't be filled from the UI.
 */

const abi = parseAbi([
  "function supportsInterface(bytes4) view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function tokenByIndex(uint256) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
]);

const ERC721 = "0x80ac58cd";
const ENUMERABLE = "0x780e9d63";

/** Bigger collections are refused: a partial set would silently leave tokens out of a deal. */
export const MAX_SCAN_TOKENS = 10_000;
const URI_BATCH = 100;
const FETCH_CONCURRENCY = 24;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_JSON_BYTES = 1_000_000;
const MAX_ATTRIBUTES = 64;
const MAX_LABEL = 64;
const MAX_JOBS = 3;
/**
 * A scan's wall-clock budget. Metadata hosts are the collection's choice and may be slow on
 * purpose; past this, the tokens not yet read count as `failed` and the scan ends with what it has,
 * so a few hostile collections can't hold every slot for long.
 */
export const JOB_BUDGET_MS = 3 * 60_000;
const READY_TTL_MS = 10 * 60_000;
const FAILED_TTL_MS = 2 * 60_000;

/** `values[i]` is a [traitType, value] pair; each token lists the indexes it carries. */
export type WireCatalog = {
  values: [string, string][];
  tokens: [string, number[]][];
  enumerable: boolean;
  /** Tokens whose metadata couldn't be read. They are left out of every set. */
  failed: number;
};

export type ScanSnapshot =
  | { state: "scanning"; done: number; total: number }
  | { state: "ready"; catalog: WireCatalog }
  | { state: "unsupported"; reason: string }
  | { state: "busy" };

type Job = { snapshot: ScanSnapshot; expires: number };
const jobs = new Map<string, Job>();
let running = 0;

let cached: PublicClient | undefined;
const client = () => (cached ??= createPublicClient({ chain, transport: http(RPC_URL), batch: { multicall: true } }) as PublicClient);

/** Drops finished scans whose time is up, so the map holds only live and recent ones. */
function evictExpired(now: number) {
  for (const [key, job] of jobs) if (job.expires <= now) jobs.delete(key);
}

/** The scan for `collection` if one is cached or running, else `null` (asking starts nothing). */
export function existingScan(collection: Address): ScanSnapshot | null {
  const now = Date.now();
  evictExpired(now);
  return jobs.get(collection.toLowerCase())?.snapshot ?? null;
}

/** Whether a new scan could start now (one runs per slot, `MAX_JOBS` at a time). */
export const scanSlotFree = () => running < MAX_JOBS;

/** The scan for `collection`: cached, running, or newly started. Never throws. */
export function scanCollection(collection: Address): ScanSnapshot {
  const existing = existingScan(collection);
  if (existing) return existing;

  if (!scanSlotFree()) return { state: "busy" };
  const job: Job = { snapshot: { state: "scanning", done: 0, total: 0 }, expires: Number.POSITIVE_INFINITY };
  jobs.set(collection.toLowerCase(), job);
  running++;
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(), JOB_BUDGET_MS);
  timer.unref?.();
  run(collection, job, budget.signal)
    .catch((error) => {
      if (!(error instanceof Unsupported)) console.error(`collection scan ${collection} failed:`, error);
      job.snapshot = { state: "unsupported", reason: error instanceof Unsupported ? error.message : "Couldn't read this collection." };
      job.expires = Date.now() + FAILED_TTL_MS;
    })
    .finally(() => {
      clearTimeout(timer);
      running--;
    });
  return job.snapshot;
}

class Unsupported extends Error {}

async function run(collection: Address, job: Job, budget: AbortSignal) {
  const rpc = client();
  const address = getAddress(collection);

  const code = await rpc.getCode({ address });
  if (!code || code === "0x") throw new Unsupported("There is no contract at this address.");

  const is721 = await rpc.readContract({ address, abi, functionName: "supportsInterface", args: [ERC721] }).catch(() => null);
  if (is721 !== true) throw new Unsupported("This isn't an ERC-721 collection.");

  const supply = await rpc.readContract({ address, abi, functionName: "totalSupply" }).catch(() => null);
  if (supply === null) throw new Unsupported("This collection doesn't say how many tokens it has, so its traits can't be listed.");
  if (supply === 0n) throw new Unsupported("This collection has no tokens yet.");
  if (supply > BigInt(MAX_SCAN_TOKENS)) throw new Unsupported(`This collection has more than ${MAX_SCAN_TOKENS.toLocaleString()} tokens, which is more than trait requests support for now.`);
  const total = Number(supply);

  const enumerable = (await rpc.readContract({ address, abi, functionName: "supportsInterface", args: [ENUMERABLE] }).catch(() => false)) === true;
  const ids = enumerable ? await enumerate(rpc, address, total) : await sequential(rpc, address, total);
  job.snapshot = { state: "scanning", done: 0, total: ids.length };

  const uris = new Array<string | null>(ids.length).fill(null);
  for (let start = 0; start < ids.length; start += URI_BATCH) {
    if (budget.aborted) throw new Unsupported("Reading this collection took too long. Try again later.");
    const batch = ids.slice(start, start + URI_BATCH);
    const results = await rpc.multicall({
      contracts: batch.map((id) => ({ address, abi, functionName: "tokenURI", args: [id] }) as const),
      allowFailure: true,
    });
    results.forEach((r, i) => {
      uris[start + i] = r.status === "success" ? (r.result as string) : null;
    });
  }
  if (uris.every((u) => u === null)) throw new Unsupported("This collection doesn't return token metadata, so its traits can't be read.");

  const pairs = new Map<string, number>();
  const values: [string, string][] = [];
  const tokens: [string, number[]][] = [];
  let failed = 0;
  let done = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: FETCH_CONCURRENCY }, async () => {
      while (next < ids.length) {
        const i = next++;
        const uri = uris[i];
        // Out of time: the rest count as failed, and the scan ends with what it has.
        const attrs = uri && !budget.aborted ? await readAttributes(uri, budget) : null;
        if (attrs === null) {
          failed++;
        } else {
          const indexes = attrs.map(([type, value]) => {
            const k = `${type}\u001f${value}`;
            let index = pairs.get(k);
            if (index === undefined) {
              index = values.push([type, value]) - 1;
              pairs.set(k, index);
            }
            return index;
          });
          tokens.push([ids[i].toString(), [...new Set(indexes)]]);
        }
        job.snapshot = { state: "scanning", done: ++done, total: ids.length };
      }
    }),
  );

  if (values.length === 0) {
    throw new Unsupported(budget.aborted ? "Reading this collection took too long. Try again later." : "This collection's metadata has no traits.");
  }
  tokens.sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : 1));
  job.snapshot = { state: "ready", catalog: { values, tokens, enumerable, failed } };
  // A scan cut short by its budget is kept only briefly, so a later try can do better.
  job.expires = Date.now() + (budget.aborted ? FAILED_TTL_MS : READY_TTL_MS);
}

async function enumerate(rpc: PublicClient, address: Address, total: number): Promise<bigint[]> {
  const out: bigint[] = [];
  for (let start = 0; start < total; start += 500) {
    const n = Math.min(500, total - start);
    const results = await rpc.multicall({
      contracts: Array.from({ length: n }, (_, i) => ({ address, abi, functionName: "tokenByIndex", args: [BigInt(start + i)] }) as const),
      allowFailure: true,
    });
    for (const r of results) if (r.status === "success") out.push(r.result as bigint);
  }
  if (out.length !== total) throw new Unsupported("This collection's token list couldn't be read completely.");
  return out;
}

/** Without enumeration, assume ids run 0..n-1 or 1..n, and check the assumption on the last id. */
async function sequential(rpc: PublicClient, address: Address, total: number): Promise<bigint[]> {
  const exists = (id: number) =>
    rpc.readContract({ address, abi, functionName: "ownerOf", args: [BigInt(id)] }).then(() => true, () => false);
  const from = (await exists(0)) ? 0 : 1;
  if (!(await exists(from + total - 1)) || (await exists(from + total))) {
    throw new Unsupported("This collection's token ids aren't a simple 0..n or 1..n range, so they can't be listed without an index.");
  }
  return Array.from({ length: total }, (_, i) => BigInt(from + i));
}

// ── Metadata ───────────────────────────────────────────────────────────────────────────────────


/**
 * Addresses a metadata fetch must never reach: loopback, private (RFC 1918), CGNAT, link-local
 * (cloud metadata lives at 169.254.169.254), unique-local IPv6, multicast, reserved and
 * documentation ranges, and every IPv4-mapped / translated IPv6 form (which would smuggle one of
 * the IPv4 ranges past the IPv4 checks). Two lists, because Node also matches an IPv4 address
 * against IPv4-mapped IPv6 rules: one list holding `::ffff:0:0/96` would refuse every IPv4 address.
 */
const BLOCKED_V4 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED_V4.addSubnet(net, prefix, "ipv4");
const BLOCKED_V6 = new BlockList();
for (const [net, prefix] of [
  ["::", 96], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) BLOCKED_V6.addSubnet(net, prefix, "ipv6");
BLOCKED_V6.addAddress("::1", "ipv6");

/** Whether `ip` (a literal address) is a public unicast address a fetch may go to. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !BLOCKED_V4.check(ip, "ipv4");
  if (family === 6) return !BLOCKED_V6.check(ip, "ipv6");
  return false;
}

export type Resolve = (host: string) => Promise<{ address: string }[]>;

/**
 * The real lookup, with each host's answer kept for a minute: a scan fetches thousands of URIs on
 * the same one or two hosts, and the system resolver may not cache.
 */
const HOST_TTL_MS = 60_000;
const hostCache = new Map<string, { addresses: { address: string }[]; expires: number }>();
const resolveHost: Resolve = async (host) => {
  const now = Date.now();
  const hit = hostCache.get(host);
  if (hit && hit.expires > now) return hit.addresses;
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (hostCache.size >= 1_000) hostCache.clear();
  hostCache.set(host, { addresses, expires: now + HOST_TTL_MS });
  return addresses;
};

/**
 * The URL to fetch for a `tokenURI`, or `null` when it may not be fetched. Any collection can point
 * `tokenURI` anywhere, so only https on a public host is allowed: names the DNS resolves to any
 * non-public address are refused, as are literal IPs (no metadata host needs one).
 *
 * The name is resolved again by `fetch`, so a host that answers differently the second time (DNS
 * rebinding) could still slip through; with https only, redirects refused and the body never shown
 * to the caller (only parsed traits are), that residual risk is accepted.
 */
export async function safeUrl(uri: string, resolve: Resolve = resolveHost): Promise<URL | null> {
  const resolved = uri.startsWith("ipfs://") ? IPFS_GATEWAY + uri.slice("ipfs://".length).replace(/^ipfs\//, "") : uri;
  let url: URL;
  try {
    url = new URL(resolved);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  // `localhost.` is `localhost`: a trailing dot only marks the name as fully qualified.
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host || !host.includes(".")) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  // Literal IPs: IPv4 dotted quads and any IPv6 are refused outright.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  let addresses: { address: string }[];
  try {
    addresses = await resolve(host);
  } catch {
    return null;
  }
  if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) return null;
  return url;
}

/**
 * The body as text, or `null` past `max` bytes. A declared length over the cap is refused before
 * reading; otherwise the body is read in chunks and dropped as soon as it passes the cap, so a huge
 * or endless response never sits in memory whole.
 */
export async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A `tokenURI`'s JSON: inline, or fetched from a public https host (see `safeUrl`). `null` when it can't be fetched. */
export async function readJson(uri: string, budget?: AbortSignal): Promise<unknown> {
  const base64 = "data:application/json;base64,";
  const utf8 = "data:application/json;utf8,";
  if (uri.startsWith(base64)) return JSON.parse(Buffer.from(uri.slice(base64.length), "base64").toString("utf8"));
  if (uri.startsWith(utf8)) return JSON.parse(decodeURIComponent(uri.slice(utf8.length)));

  const url = await safeUrl(uri);
  if (!url) return null;
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal = budget ? AbortSignal.any([timeout, budget]) : timeout;
  const res = await fetch(url, { signal, redirect: "error" });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const text = await readCapped(res, MAX_JSON_BYTES);
  return text === null ? null : JSON.parse(text);
}

/** [traitType, value] pairs, or null when the metadata can't be read at all. */
async function readAttributes(uri: string, budget?: AbortSignal): Promise<[string, string][] | null> {
  try {
    const json = (await readJson(uri, budget)) as { attributes?: unknown } | null;
    if (!json || typeof json !== "object") return null;
    if (!Array.isArray(json.attributes)) return [];
    const out: [string, string][] = [];
    for (const a of json.attributes.slice(0, MAX_ATTRIBUTES)) {
      const type = (a as { trait_type?: unknown })?.trait_type;
      const value = (a as { value?: unknown })?.value;
      if (typeof type !== "string" || (typeof value !== "string" && typeof value !== "number")) continue;
      out.push([type.slice(0, MAX_LABEL), String(value).slice(0, MAX_LABEL)]);
    }
    return out;
  } catch {
    return null;
  }
}
