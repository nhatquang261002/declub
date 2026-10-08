import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityEvent } from "../lib/clubs";
import { activityKey } from "../lib/server/activity";
import { getStore } from "../lib/server/store";
import { detailHandler, listHandler } from "../lib/server/clubRoutes";
import { makeRegistry, parseAssets, registry } from "../lib/verifiedAssets";
import { GET as list } from "../app/api/clubs/route";
import { GET as detail } from "../app/api/clubs/[token]/route";

const club = registry.clubs()[0]!;
const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
const get = (path = "http://localhost/api/clubs") => new Request(path, { headers: { "x-forwarded-for": "203.0.113.9" } });

describe("GET /api/clubs", () => {
  it("lists every Club with its stats, publicly cacheable", async () => {
    const res = await list(get());
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /s-maxage/);
    const body = await res.json();
    assert.equal(body.logging, true);
    assert.deepEqual(
      body.clubs.map((c: { token: string }) => c.token).sort(),
      registry
        .clubs()
        .map((c) => c.address.toLowerCase())
        .sort(),
    );
    assert.equal(body.clubs[0].stats.momentum, 0);
  });

  it("reflects what the log holds", async () => {
    const store = getStore()!;
    const now = Math.floor(Date.now() / 1000);
    const e: ActivityEvent = {
      id: "0xroute:0",
      kind: "swapped",
      contract: "0xswap",
      deal: "1",
      block: 1,
      at: now - 60,
      parties: ["0xaa", "0xbb"],
      tokens: [club.address.toLowerCase()],
    };
    await store.rank(activityKey(club.address), [{ member: JSON.stringify(e), score: e.at }], 10);
    const body = await (await list(get())).json();
    const mine = body.clubs.find((c: { token: string }) => c.token === club.address.toLowerCase());
    assert.equal(mine.stats.completed7d, 1);
    assert.equal(body.clubs[0].token, club.address.toLowerCase(), "the busiest Club comes first");
  });
});

describe("GET /api/clubs/[token]", () => {
  it("returns one Club's stats and latest completed swaps", async () => {
    const res = await detail(get(), ctx(club.address.toLowerCase()));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.club.symbol, club.symbol);
    assert.ok(Array.isArray(body.recent));
    assert.ok(body.recent.every((e: ActivityEvent) => e.kind === "swapped"));
  });

  it("rejects what isn't an address, and answers 404 for an asset with no Club", async () => {
    assert.equal((await detail(get(), ctx("nope"))).status, 400);
    const none = await detail(get(), ctx("0x00000000000000000000000000000000000000f1"));
    assert.equal(none.status, 404);
    assert.equal((await none.json()).error, "not_found");
  });
});

describe("which assets have a Club", () => {
  const A = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
  const B = "0xd300f095f456D59AAc122B0100833fE195136F6c";
  const C = "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
  const D = "0xA3301cec17d13eD03E343cdfdd14Ab027b8ec298";
  const entry = (address: string, over: Record<string, unknown> = {}) => ({
    chainId: 10143,
    address,
    kind: "erc721",
    name: "Name",
    symbol: "SYM",
    status: "verified",
    note: "Why.",
    ...over,
  });
  const reg = makeRegistry(parseAssets([entry(A), entry(B, { club: false }), entry(C, { status: "blocked" }), entry(D, { club: "archived" })]));
  const deps = { settlements: async () => [] };

  it("serves a Club, archived or not, and nothing else", async () => {
    const get = detailHandler(reg, deps);
    assert.equal((await get(new Request("http://x"), ctx(A))).status, 200);
    const archived = await get(new Request("http://x"), ctx(D));
    assert.equal(archived.status, 200);
    assert.equal((await archived.json()).club.archived, true);
    for (const hidden of [B, C, "0x00000000000000000000000000000000000000f1"]) {
      assert.equal((await get(new Request("http://x"), ctx(hidden))).status, 404, hidden);
    }
  });

  it("lists only the Clubs, in the registry's order", async () => {
    const body = await (await listHandler(reg, deps)(new Request("http://x"))).json();
    assert.deepEqual(
      body.clubs.map((c: { token: string }) => c.token),
      [A.toLowerCase(), D.toLowerCase()],
    );
  });
});
