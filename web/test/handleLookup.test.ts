import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import { takerError } from "../lib/createFlow";
import { looksLikeHandle, parseHandleQuery, profileKey, userWalletsKey, type ProfileProvider, type StoredProfile } from "../lib/profiles";
import type { UserGate } from "../lib/server/gate";
import { lookupHandle, lookupHandler, type FindUser } from "../lib/server/handleLookup";
import { memoryStore, type Store } from "../lib/server/store";

const W1 = "0x00000000000000000000000000000000000000a1";
const W2 = "0x00000000000000000000000000000000000000b2";
const W3 = "0x00000000000000000000000000000000000000c3";

/** Writes shared-profile rows the way `syncProfile` does. */
async function share(store: Store, userId: string, provider: ProfileProvider, handle: string, wallets: string[]) {
  const row: StoredProfile = { provider, handle, userId, updatedAt: 1 };
  for (const wallet of wallets) await store.set(profileKey(wallet), row);
  await store.setMembers(userWalletsKey(userId), wallets.map((w) => w.toLowerCase()));
}

/** Privy as a table of `provider:username` → user id, recording the lookups made. */
function privy(users: Record<string, string>) {
  const calls: string[] = [];
  const find: FindUser = async (provider, username) => {
    calls.push(`${provider}:${username}`);
    return users[`${provider}:${username}`] ?? null;
  };
  return { find, calls };
}

describe("parseHandleQuery / looksLikeHandle", () => {
  it("reads @handles, bare names and x.com links", () => {
    assert.deepEqual(parseHandleQuery("@Bob_1"), { twitter: "Bob_1", discord: "bob_1" });
    assert.deepEqual(parseHandleQuery("  bob  "), { twitter: "bob", discord: "bob" });
    assert.deepEqual(parseHandleQuery("https://x.com/Bob?s=20"), { twitter: "Bob" });
    assert.deepEqual(parseHandleQuery("twitter.com/@bob/"), { twitter: "bob" });
  });

  it("keeps each provider to the names it allows", () => {
    assert.deepEqual(parseHandleQuery("bob.eth"), { discord: "bob.eth" }, "dots are Discord only");
    assert.deepEqual(parseHandleQuery("a_very_long_name_here"), { discord: "a_very_long_name_here" }, "X stops at 15");
    assert.deepEqual(parseHandleQuery("b"), { twitter: "b" }, "Discord starts at 2");
    assert.equal(parseHandleQuery("bob smith"), null);
    assert.equal(parseHandleQuery("x.com/bob.eth"), null);
    assert.equal(parseHandleQuery(""), null);
  });

  it("reads 0x… as an address being typed, and @0x… as a handle", () => {
    assert.equal(looksLikeHandle("0x12ab"), false);
    assert.equal(looksLikeHandle(W1), false);
    assert.equal(looksLikeHandle("@0xbob"), true);
    assert.equal(looksLikeHandle("@bob"), true);
    assert.equal(looksLikeHandle(""), false);
  });

  it("makes the maker pick a wallet for a handle before the deal can go ahead", () => {
    assert.match(takerError("@bob", undefined, true)!, /Pick which of their wallets/);
    assert.match(takerError("@bob", undefined, false)!, /valid wallet address/, "without Privy a handle is just invalid");
    assert.equal(takerError(W1, undefined, true), null);
  });
});

describe("lookupHandle", () => {
  it("finds the wallets a trader shares under the handle, with the handle as they wrote it", async () => {
    const store = memoryStore();
    await share(store, "bob", "twitter", "Bob", [W1, W2]);
    const { find } = privy({ "twitter:bob": "bob" });
    const r = await lookupHandle(store, "alice", "@bob", find);
    assert.deepEqual(r, { matches: [{ provider: "twitter", handle: "Bob", wallets: [getAddress(W1), getAddress(W2)] }], self: false });
  });

  it("finds nobody who hasn't shared a profile, even though Privy knows them", async () => {
    const store = memoryStore();
    const { find, calls } = privy({ "twitter:bob": "bob" });
    assert.deepEqual(await lookupHandle(store, "alice", "@bob", find), { matches: [], self: false });
    assert.deepEqual(calls, ["twitter:bob", "discord:bob"]);
  });

  it("ignores a share made under another handle (a rename not yet synced)", async () => {
    const store = memoryStore();
    await share(store, "bob", "twitter", "oldbob", [W1]);
    const { find } = privy({ "twitter:newbob": "bob" });
    assert.deepEqual(await lookupHandle(store, "alice", "newbob", find), { matches: [], self: false });
  });

  it("doesn't match the same name on the other provider", async () => {
    const store = memoryStore();
    // Bob shares X; the lookup finds him by Discord name only, which he doesn't show.
    await share(store, "bob", "twitter", "bobx", [W1]);
    const { find } = privy({ "discord:bob": "bob" });
    assert.deepEqual(await lookupHandle(store, "alice", "bob", find), { matches: [], self: false });
  });

  it("leaves out wallets whose rows belong to someone else", async () => {
    const store = memoryStore();
    await share(store, "bob", "twitter", "bob", [W1, W2]);
    // W2 was unlinked from Bob and shared by Carol since; Bob's wallet set is stale.
    await store.set(profileKey(W2), { provider: "twitter", handle: "carol", userId: "carol", updatedAt: 2 } satisfies StoredProfile);
    const { find } = privy({ "twitter:bob": "bob" });
    const r = await lookupHandle(store, "alice", "bob", find);
    assert.deepEqual(r?.matches[0].wallets, [getAddress(W1)]);
  });

  it("shows two different people who share the same name on X and on Discord", async () => {
    const store = memoryStore();
    await share(store, "u-x", "twitter", "sam", [W1]);
    await share(store, "u-d", "discord", "sam", [W3]);
    const { find } = privy({ "twitter:sam": "u-x", "discord:sam": "u-d" });
    const r = await lookupHandle(store, "alice", "sam", find);
    assert.deepEqual(
      r?.matches.map((m) => [m.provider, m.wallets]),
      [["twitter", [getAddress(W1)]], ["discord", [getAddress(W3)]]],
    );
  });

  it("says when the handle is the caller's own, and shows none of their wallets", async () => {
    const store = memoryStore();
    await share(store, "alice", "twitter", "alice", [W1]);
    const { find } = privy({ "twitter:alice": "alice" });
    assert.deepEqual(await lookupHandle(store, "alice", "@alice", find), { matches: [], self: true });
  });

  it("returns null for text that can't be a handle, without asking Privy", async () => {
    const { find, calls } = privy({});
    assert.equal(await lookupHandle(memoryStore(), "alice", "not a handle", find), null);
    assert.deepEqual(calls, []);
  });
});

describe("GET /api/profiles/lookup", () => {
  const signedIn = (store: Store) => async (): Promise<UserGate> => ({ store, user: { id: "alice" } }) as unknown as UserGate;
  const get = (handle: string) => new Request(`http://localhost/api/profiles/lookup?handle=${encodeURIComponent(handle)}`);

  it("answers the matches for a signed-in caller", async () => {
    const store = memoryStore();
    await share(store, "bob", "twitter", "bob", [W1]);
    const GET = lookupHandler({ gate: signedIn(store), find: privy({ "twitter:bob": "bob" }).find });
    const res = await GET(get("@bob"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      enabled: true,
      matches: [{ provider: "twitter", handle: "bob", wallets: [getAddress(W1)] }],
      self: false,
    });
  });

  it("passes the gate's answer through: signed out, or not configured", async () => {
    const out = lookupHandler({ gate: async () => Response.json({ error: "unauthorized" }, { status: 401 }) });
    assert.equal((await out(get("@bob"))).status, 401);
    const off = lookupHandler({ gate: async () => Response.json({ enabled: false }) });
    assert.deepEqual(await (await off(get("@bob"))).json(), { enabled: false });
  });

  it("refuses text that isn't a handle, and reports a Privy failure as retryable", async () => {
    const store = memoryStore();
    const bad = lookupHandler({ gate: signedIn(store), find: privy({}).find });
    assert.equal((await bad(get("two words"))).status, 400);
    const down = lookupHandler({
      gate: signedIn(store),
      find: async () => {
        throw new Error("privy down");
      },
    });
    assert.equal((await down(get("@bob"))).status, 502);
  });
});
