/**
 * Dumps the whole server store to a file and restores it (ADR 0055).
 *
 *   cd web
 *   node --import ./test/register.mjs scripts/store-backup.ts --out ~/backups/declub-$(date +%F).jsonl.gz
 *   ... --out file.jsonl.gz --min-keys 500    # exit 1 if fewer keys than that were found (the default is 1)
 *   node --import ./test/register.mjs scripts/store-backup.ts --restore file.jsonl.gz            # counts, writes nothing
 *   node --import ./test/register.mjs scripts/store-backup.ts --restore file.jsonl.gz --confirm  # writes what isn't there
 *   node --import ./test/register.mjs scripts/store-backup.ts --restore file.jsonl.gz --confirm --overwrite
 *
 * Every durable `declub:` key, byte for byte: strings, sets and sorted sets. Keys that expire
 * (rate limits, locks) and the cached live standings are left out. The dump is not checked on the
 * way back, unlike the sponsor, member and epoch backups (ADR 0053, 0054): restore those first,
 * with their own scripts, and let this fill in the rest. Without --overwrite a key already in the
 * store is kept, so restoring into a store that has moved on never rolls it back.
 *
 * The file holds Privy user ids, wallets and avatars, and is written readable by you alone. Keep it
 * outside the repo and off any shared drive. Run it from a schedule (cron, a CI job) that has the
 * Upstash credentials; Upstash's own backups, where the plan has them, are a second copy. Needs the
 * same credentials as the app.
 */
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { flag, loadEnv, option, requireStore } from "./env";

loadEnv(path.resolve(import.meta.dirname, ".."));

async function main() {
  requireStore();
  const { Redis } = await import("@upstash/redis");
  const { dumpStore, restoreStore } = await import("../lib/server/storeBackup");

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN!;
  // Raw strings, not parsed JSON: what comes back is what was stored.
  const redis = new Redis({ url, token, automaticDeserialization: false });

  const raw: import("../lib/server/storeBackup").RawStore = {
    async scan(cursor, match, count) {
      const [next, keys] = await redis.scan(cursor, { match, count });
      return { cursor: String(next), keys };
    },
    async types(keys) {
      const p = redis.pipeline();
      for (const k of keys) p.type(k);
      return (await p.exec()) as string[];
    },
    async ttls(keys) {
      const p = redis.pipeline();
      for (const k of keys) p.ttl(k);
      return (await p.exec()) as number[];
    },
    async strings(keys) {
      return keys.length === 0 ? [] : ((await redis.mget(...keys)) as (string | null)[]);
    },
    members: async (key) => (await redis.smembers(key)) as string[],
    async ranked(key) {
      const flat = (await redis.zrange(key, 0, -1, { withScores: true })) as (string | number)[];
      const out: [string, number][] = [];
      for (let i = 0; i < flat.length; i += 2) out.push([String(flat[i]), Number(flat[i + 1])]);
      return out;
    },
    async exists(keys) {
      const p = redis.pipeline();
      for (const k of keys) p.exists(k);
      return ((await p.exec()) as number[]).map((n) => n > 0);
    },
    async del(keys) {
      await redis.del(...keys);
    },
    async set(key, value) {
      await redis.set(key, value);
    },
    async add(key, members) {
      await redis.sadd(key, members[0]!, ...members.slice(1));
    },
    async rank(key, entries) {
      await redis.zadd(key, { score: entries[0]![1], member: entries[0]![0] }, ...entries.slice(1).map(([member, score]) => ({ score, member })));
    },
  };

  const out = option("out");
  if (out) {
    const gzip = createGzip();
    const file = createWriteStream(out, { mode: 0o600 });
    const done = pipeline(gzip, file);
    const write = async (line: string) => {
      if (!gzip.write(line + "\n")) await once(gzip, "drain");
    };
    await write(JSON.stringify({ declubStoreBackup: 1, at: new Date().toISOString() }));
    const result = await dumpStore(raw, (entry) => write(JSON.stringify(entry)));
    gzip.end();
    await done;
    console.log(
      `wrote ${result.keys} keys to ${out}  (${Object.entries(result.byType)
        .map(([t, n]) => `${n} ${t}`)
        .join(", ")})`,
    );
    const { ephemeral, expiring, unsupported } = result.skipped;
    console.log(`left out: ${expiring} expiring, ${ephemeral} cached or locked, ${unsupported} of an unsupported type`);
    // A schedule that saves an empty store every night is worse than one that fails: say so.
    const min = Number(option("min-keys") ?? 1);
    if (result.keys < min) throw new Error(`Found ${result.keys} keys, fewer than --min-keys ${min}. Is this the right store?`);
    return;
  }

  const from = option("restore");
  if (!from) throw new Error("Give --out <file> to dump or --restore <file> to restore.");
  async function* lines() {
    const rl = createInterface({ input: createReadStream(from!).pipe(createGunzip()), crlfDelay: Infinity });
    let first = true;
    for await (const line of rl) {
      if (!line) continue;
      const parsed: unknown = JSON.parse(line);
      if (first) {
        first = false;
        if ((parsed as { declubStoreBackup?: number })?.declubStoreBackup !== 1) throw new Error("That isn't a DeClub store backup.");
        continue;
      }
      yield parsed;
    }
  }
  const confirm = flag("confirm");
  const result = await restoreStore(raw, lines(), { overwrite: flag("overwrite"), dryRun: !confirm });
  console.log(`${confirm ? "wrote" : "would write"} ${result.written} keys, kept ${result.kept} already there, refused ${result.refused} lines`);
  if (!confirm) console.log("Nothing was written. Add --confirm to restore.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
