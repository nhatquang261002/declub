/**
 * A dump of the whole server store as lines of JSON (ADR 0055), for the things nothing else can
 * recreate or that are slow to: roles, bans, profiles, avatars, challenges, likes and the rest.
 * The sponsor ledger, the member lists and the built epochs have their own, checked, backups
 * (ADR 0053, 0054); this one holds everything, unchecked, so a restore from it is only as fresh as
 * the dump. It reads the store's raw strings, so a restore puts back the same bytes.
 *
 * What is left out is what the app makes again by itself: anything with an expiry (rate-limit
 * counters and the locks, which are counters that expire: restored without their expiry a lock
 * would block for ever), the locks that don't expire by name, and the cached live standings.
 */

/** The three shapes the store uses (`Store` in ./store.ts). Any other type is counted and skipped. */
export type Entry =
  { k: string; t: "string"; v: string } | { k: string; t: "set"; v: string[] } | { k: string; t: "zset"; v: [member: string, score: number][] };

/** The commands a dump and a restore need. Upstash in the script, a map in the tests. */
export type RawStore = {
  scan(cursor: string, match: string, count: number): Promise<{ cursor: string; keys: string[] }>;
  types(keys: string[]): Promise<string[]>;
  /** Seconds to expiry, or -1 for a key that never expires. */
  ttls(keys: string[]): Promise<number[]>;
  strings(keys: string[]): Promise<(string | null)[]>;
  members(key: string): Promise<string[]>;
  /** Lowest score first. */
  ranked(key: string): Promise<[string, number][]>;
  exists(keys: string[]): Promise<boolean[]>;
  del(keys: string[]): Promise<void>;
  set(key: string, value: string): Promise<void>;
  add(key: string, members: string[]): Promise<void>;
  rank(key: string, entries: [string, number][]): Promise<void>;
};

const PREFIX = "declub:";
/** Keys the app makes again: rate-limit counters, locks of every kind, and the cached live standings. */
const EPHEMERAL = /^declub:rl:|[-:]lock(:|$)|^declub:rewards:\d+:standings:/;
export const isEphemeral = (key: string) => EPHEMERAL.test(key);

const BATCH = 200;
const CHUNK = 500;

export type DumpResult = { keys: number; skipped: { ephemeral: number; expiring: number; unsupported: number }; byType: Record<string, number> };

/** Writes every durable key to `write`, one entry per call. */
export async function dumpStore(raw: RawStore, write: (entry: Entry) => Promise<void> | void): Promise<DumpResult> {
  const result: DumpResult = { keys: 0, skipped: { ephemeral: 0, expiring: 0, unsupported: 0 }, byType: {} };
  let cursor = "0";
  // SCAN may return a key on more than one page.
  const seen = new Set<string>();
  do {
    const page = await raw.scan(cursor, `${PREFIX}*`, 1000);
    cursor = page.cursor;
    const keys = page.keys.filter((k) => {
      if (seen.has(k)) return false;
      seen.add(k);
      if (!isEphemeral(k)) return true;
      result.skipped.ephemeral++;
      return false;
    });
    for (let i = 0; i < keys.length; i += BATCH) {
      const all = keys.slice(i, i + BATCH);
      const ttls = await raw.ttls(all);
      const batch = all.filter((_, j) => {
        if (ttls[j]! < 0) return true;
        result.skipped.expiring++;
        return false;
      });
      const types = await raw.types(batch);
      const strings = await raw.strings(batch.filter((_, j) => types[j] === "string"));
      let nextString = 0;
      for (let j = 0; j < batch.length; j++) {
        const k = batch[j]!;
        const t = types[j];
        let entry: Entry | null = null;
        if (t === "string") {
          // A key that expired between the scan and the read is gone, not an empty string.
          const v = strings[nextString++];
          if (v !== null && v !== undefined) entry = { k, t, v };
        } else if (t === "set") entry = { k, t, v: await raw.members(k) };
        else if (t === "zset") entry = { k, t, v: await raw.ranked(k) };
        else if (t !== "none") result.skipped.unsupported++;
        if (!entry) continue;
        await write(entry);
        result.keys++;
        result.byType[entry.t] = (result.byType[entry.t] ?? 0) + 1;
      }
    }
  } while (cursor !== "0");
  return result;
}

export type RestoreOptions = {
  /** Replace a key that is already there. Without it, an existing key is left as it is. */
  overwrite?: boolean;
  /** Count what would be written and write nothing. */
  dryRun?: boolean;
};
export type RestoreResult = { written: number; kept: number; refused: number };

const valid = (e: unknown): e is Entry => {
  const x = e as Partial<Entry> | null;
  if (!x || typeof x.k !== "string" || !x.k.startsWith(PREFIX) || isEphemeral(x.k)) return false;
  if (x.t === "string") return typeof x.v === "string";
  if (x.t === "set") return Array.isArray(x.v) && x.v.every((m) => typeof m === "string");
  if (x.t === "zset") return Array.isArray(x.v) && x.v.every((p) => Array.isArray(p) && typeof p[0] === "string" && Number.isFinite(p[1]));
  return false;
};

/** Puts dumped entries back. Only `declub:` keys of the three known shapes are accepted. */
export async function restoreStore(raw: RawStore, entries: AsyncIterable<unknown>, options: RestoreOptions = {}): Promise<RestoreResult> {
  const result: RestoreResult = { written: 0, kept: 0, refused: 0 };
  let batch: Entry[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const present = options.overwrite ? batch.map(() => false) : await raw.exists(batch.map((e) => e.k));
    for (let i = 0; i < batch.length; i++) {
      const e = batch[i]!;
      if (present[i]) {
        result.kept++;
        continue;
      }
      result.written++;
      if (options.dryRun) continue;
      if (options.overwrite) await raw.del([e.k]);
      if (e.t === "string") await raw.set(e.k, e.v);
      else if (e.t === "set") for (let j = 0; j < e.v.length; j += CHUNK) await raw.add(e.k, e.v.slice(j, j + CHUNK));
      else for (let j = 0; j < e.v.length; j += CHUNK) await raw.rank(e.k, e.v.slice(j, j + CHUNK));
    }
    batch = [];
  };
  for await (const entry of entries) {
    if (!valid(entry)) {
      result.refused++;
      continue;
    }
    batch.push(entry);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  return result;
}
