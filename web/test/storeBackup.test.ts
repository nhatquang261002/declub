import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { dumpStore, isEphemeral, restoreStore, type Entry, type RawStore } from "../lib/server/storeBackup";

type Value = { t: "string"; v: string } | { t: "set"; v: Set<string> } | { t: "zset"; v: Map<string, number> } | { t: "hash"; v: Record<string, string> };
type Item = Value & { ttl: number };

/** A map standing in for Redis, with the same paging and the same raw strings. */
function fake(pageSize = 3) {
  const data = new Map<string, Item>();
  const writes: string[] = [];
  const raw: RawStore & { vanish?: string } = {
    async scan(cursor, match, count) {
      assert.ok(count > 0);
      const prefix = match.replace("*", "");
      const keys = [...data.keys()].filter((k) => k.startsWith(prefix));
      const at = Number(cursor);
      const next = at + pageSize;
      // A real scan may repeat a key; give the first one again on the second page.
      const page = keys.slice(at, next);
      if (at > 0 && keys[0]) page.push(keys[0]);
      return { cursor: next >= keys.length ? "0" : String(next), keys: page };
    },
    async types(keys) {
      return keys.map((k) => data.get(k)?.t ?? "none");
    },
    async ttls(keys) {
      return keys.map((k) => data.get(k)?.ttl ?? -2);
    },
    async strings(keys) {
      return keys.map((k) => {
        if (k === raw.vanish) return null;
        const item = data.get(k);
        return item?.t === "string" ? item.v : null;
      });
    },
    async members(key) {
      const item = data.get(key);
      return item?.t === "set" ? [...item.v] : [];
    },
    async ranked(key) {
      const item = data.get(key);
      return item?.t === "zset" ? [...item.v].sort((a, b) => a[1] - b[1]) : [];
    },
    async exists(keys) {
      return keys.map((k) => data.has(k));
    },
    async del(keys) {
      writes.push(`del ${keys.join(",")}`);
      for (const k of keys) data.delete(k);
    },
    async set(key, value) {
      writes.push(`set ${key}`);
      data.set(key, { t: "string", v: value, ttl: -1 });
    },
    async add(key, members) {
      writes.push(`add ${key} ${members.length}`);
      const item = data.get(key);
      const set = item?.t === "set" ? item.v : new Set<string>();
      for (const m of members) set.add(m);
      data.set(key, { t: "set", v: set, ttl: -1 });
    },
    async rank(key, entries) {
      writes.push(`rank ${key} ${entries.length}`);
      const item = data.get(key);
      const map = item?.t === "zset" ? item.v : new Map<string, number>();
      for (const [m, s] of entries) map.set(m, s);
      data.set(key, { t: "zset", v: map, ttl: -1 });
    },
  };
  return { raw, data, writes };
}

async function* from(entries: unknown[]) {
  for (const e of entries) yield e;
}

const collect = async (raw: RawStore) => {
  const out: Entry[] = [];
  const result = await dumpStore(raw, (e) => void out.push(e));
  return { out, result };
};

describe("the store dump (ADR 0055)", () => {
  let store: ReturnType<typeof fake>;
  beforeEach(() => {
    store = fake();
    const { data } = store;
    data.set("declub:club-roles:10143:0xa", { t: "string", v: '{"owner":"did:privy:abc","moderators":[]}', ttl: -1 });
    data.set("declub:profile:0xb", { t: "string", v: "5", ttl: -1 });
    data.set("declub:about:0xc", { t: "string", v: 'héllo "quoted" \n 🦊', ttl: -1 });
    data.set("declub:club:10143:0xa:members", { t: "set", v: new Set(["did:privy:1", "did:privy:2", "7"]), ttl: -1 });
    data.set("declub:activity:10143:0xa", {
      t: "zset",
      v: new Map([
        ['{"id":"x"}', 10],
        ['{"id":"y"}', 20],
        ["plain", 20],
      ]),
      ttl: -1,
    });
    data.set("declub:rl:club-like:1.2.3.4", { t: "string", v: "4", ttl: 30 });
    data.set("declub:challenge:10143:0xa:settle:c1", { t: "string", v: "1", ttl: 9 });
    data.set("declub:held-lock:10143:0xa:5", { t: "string", v: "1", ttl: -1 });
    data.set("declub:rewards:10143:standings:0xa", { t: "string", v: "{}", ttl: -1 });
    data.set("declub:odd", { t: "hash", v: { a: "b" }, ttl: -1 });
    data.set("other:app:key", { t: "string", v: "not ours", ttl: -1 });
  });

  it("dumps every durable key as it is stored, and puts it back byte for byte", async () => {
    const { out, result } = await collect(store.raw);
    assert.deepEqual(result.byType, { string: 3, set: 1, zset: 1 });
    assert.equal(result.keys, 5);

    const fresh = fake();
    const written = await restoreStore(fresh.raw, from(JSON.parse(JSON.stringify(out))), { overwrite: false });
    assert.deepEqual(written, { written: 5, kept: 0, refused: 0 });
    for (const key of ["declub:club-roles:10143:0xa", "declub:profile:0xb", "declub:about:0xc"]) {
      assert.deepEqual(fresh.data.get(key), store.data.get(key), key);
    }
    assert.deepEqual((await fresh.raw.members("declub:club:10143:0xa:members")).sort(), ["7", "did:privy:1", "did:privy:2"]);
    assert.deepEqual(await fresh.raw.ranked("declub:activity:10143:0xa"), await store.raw.ranked("declub:activity:10143:0xa"));
  });

  it("leaves out what the app makes again, and says how much", async () => {
    const { out, result } = await collect(store.raw);
    const keys = out.map((e) => e.k);
    for (const left of [
      "declub:rl:club-like:1.2.3.4",
      "declub:challenge:10143:0xa:settle:c1",
      "declub:held-lock:10143:0xa:5",
      "declub:rewards:10143:standings:0xa",
      "other:app:key",
      "declub:odd",
    ]) {
      assert.ok(!keys.includes(left), left);
    }
    assert.deepEqual(result.skipped, { ephemeral: 3, expiring: 1, unsupported: 1 });
  });

  it("reads past the first page, and takes a repeated key once", async () => {
    for (let i = 0; i < 20; i++) store.data.set(`declub:n:${i}`, { t: "string", v: String(i), ttl: -1 });
    const { out } = await collect(store.raw);
    const keys = out.map((e) => e.k);
    assert.equal(new Set(keys).size, keys.length, "no key twice");
    assert.equal(keys.filter((k) => k.startsWith("declub:n:")).length, 20);
  });

  it("skips a key that expired between the scan and the read, rather than saving it empty", async () => {
    store.raw.vanish = "declub:profile:0xb";
    const { out } = await collect(store.raw);
    assert.ok(!out.some((e) => e.k === "declub:profile:0xb"));
    assert.ok(
      out.some((e) => e.k === "declub:about:0xc"),
      "and the strings after it keep their own values",
    );
    assert.equal((out.find((e) => e.k === "declub:about:0xc") as { v: string }).v, 'héllo "quoted" \n 🦊');
  });

  describe("restore", () => {
    const entries: Entry[] = [
      { k: "declub:a", t: "string", v: "new" },
      { k: "declub:s", t: "set", v: ["x", "y"] },
      { k: "declub:z", t: "zset", v: [["m", 1]] },
    ];

    it("keeps a key that is already there, so a store that moved on isn't rolled back", async () => {
      store.data.set("declub:a", { t: "string", v: "newer", ttl: -1 });
      const out = await restoreStore(store.raw, from(entries));
      assert.deepEqual(out, { written: 2, kept: 1, refused: 0 });
      assert.deepEqual(store.data.get("declub:a"), { t: "string", v: "newer", ttl: -1 });
    });

    it("replaces a key only when asked, whole: a set isn't merged with what was there", async () => {
      store.data.set("declub:s", { t: "set", v: new Set(["old"]), ttl: -1 });
      await restoreStore(store.raw, from(entries), { overwrite: true });
      assert.deepEqual((await store.raw.members("declub:s")).sort(), ["x", "y"]);
      assert.equal((store.data.get("declub:a") as { v: string }).v, "new");
    });

    it("writes nothing on a dry run", async () => {
      const out = await restoreStore(store.raw, from(entries), { dryRun: true });
      assert.equal(out.written, 3);
      assert.deepEqual(store.writes, []);
      assert.ok(!store.data.has("declub:z"));
    });

    it("sends big sets and sorted sets in pieces", async () => {
      const members = Array.from({ length: 1_200 }, (_, i) => `m${i}`);
      await restoreStore(
        store.raw,
        from([
          { k: "declub:big", t: "set", v: members },
          { k: "declub:bigz", t: "zset", v: members.map((m, i) => [m, i]) },
        ]),
      );
      assert.equal((await store.raw.members("declub:big")).length, 1_200);
      assert.equal((await store.raw.ranked("declub:bigz")).length, 1_200);
      assert.equal(store.writes.filter((w) => w.startsWith("add declub:big ")).length, 3);
    });

    it("refuses what a dump never holds: other keys, locks, junk, wrong shapes", async () => {
      const out = await restoreStore(
        store.raw,
        from([
          { k: "other:app:key", t: "string", v: "x" },
          { k: "declub:rl:x", t: "string", v: "1" },
          { k: "declub:held-lock:a", t: "string", v: "1" },
          { k: "declub:q", t: "string", v: 5 },
          { k: "declub:q", t: "set", v: [1] },
          { k: "declub:q", t: "zset", v: [["m", "high"]] },
          { k: "declub:q", t: "hash", v: {} },
          null,
          "text",
          entries[0],
        ]),
      );
      assert.deepEqual(out, { written: 1, kept: 0, refused: 9 });
      assert.deepEqual(
        [...store.data.keys()].filter((k) => !k.startsWith("declub:") || k === "declub:q"),
        ["other:app:key"].filter((k) => store.data.has(k)),
      );
    });
  });

  it("knows what is ephemeral", () => {
    assert.equal(isEphemeral("declub:rl:x:y"), true);
    assert.equal(isEphemeral("declub:rewards:10143:lock"), true);
    assert.equal(isEphemeral("declub:watch:10143:fills:lock"), true);
    assert.equal(isEphemeral("declub:rewards:sponsor-lock:0xabc"), true);
    assert.equal(isEphemeral("declub:rewards:10143:standings:0xa"), true);
    assert.equal(isEphemeral("declub:club-roles:10143:0xa"), false);
    assert.equal(isEphemeral("declub:rewards:10143:epoch:3"), false);
  });
});
