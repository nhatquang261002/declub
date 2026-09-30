import { createPublicClient, getAddress, http, parseAbi, type Address, type PublicClient } from "viem";
import { chain } from "../chain";
import { RPC_URL } from "../config";

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

/** The scan for `collection`: cached, running, or newly started. Never throws. */
export function scanCollection(collection: Address): ScanSnapshot {
  const key = collection.toLowerCase();
  const existing = jobs.get(key);
  if (existing && existing.expires > Date.now()) return existing.snapshot;

  if (running >= MAX_JOBS) return { state: "busy" };
  const job: Job = { snapshot: { state: "scanning", done: 0, total: 0 }, expires: Number.POSITIVE_INFINITY };
  jobs.set(key, job);
  running++;
  run(collection, job)
    .catch((error) => {
      if (!(error instanceof Unsupported)) console.error(`collection scan ${collection} failed:`, error);
      job.snapshot = { state: "unsupported", reason: error instanceof Unsupported ? error.message : "Couldn't read this collection." };
      job.expires = Date.now() + FAILED_TTL_MS;
    })
    .finally(() => {
      running--;
    });
  return job.snapshot;
}

class Unsupported extends Error {}

async function run(collection: Address, job: Job) {
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
        const attrs = uri ? await readAttributes(uri) : null;
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

  if (values.length === 0) throw new Unsupported("This collection's metadata has no traits.");
  tokens.sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : 1));
  job.snapshot = { state: "ready", catalog: { values, tokens, enumerable, failed } };
  job.expires = Date.now() + READY_TTL_MS;
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

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

/** Any collection can point `tokenURI` anywhere, so only public https hosts are fetched. */
function safeUrl(uri: string): URL | null {
  const resolved = uri.startsWith("ipfs://") ? IPFS_GATEWAY + uri.slice("ipfs://".length).replace(/^ipfs\//, "") : uri;
  let url: URL;
  try {
    url = new URL(resolved);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  // Literal IPs: IPv4 dotted quads and any IPv6 are refused outright.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") || host.startsWith("[")) return null;
  return url;
}

async function readJson(uri: string): Promise<unknown> {
  const base64 = "data:application/json;base64,";
  const utf8 = "data:application/json;utf8,";
  if (uri.startsWith(base64)) return JSON.parse(Buffer.from(uri.slice(base64.length), "base64").toString("utf8"));
  if (uri.startsWith(utf8)) return JSON.parse(decodeURIComponent(uri.slice(utf8.length)));

  const url = safeUrl(uri);
  if (!url) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
  if (!res.ok) return null;
  const text = await res.text();
  if (text.length > MAX_JSON_BYTES) return null;
  return JSON.parse(text);
}

/** [traitType, value] pairs, or null when the metadata can't be read at all. */
async function readAttributes(uri: string): Promise<[string, string][] | null> {
  try {
    const json = (await readJson(uri)) as { attributes?: unknown } | null;
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
