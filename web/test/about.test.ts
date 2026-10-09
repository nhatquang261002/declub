import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import { aboutKey, aboutWalletsKey, BIO_MAX, cleanAbout, NAME_MAX, profilePath, type StoredAbout, type WalletProfile } from "../lib/about";
import { avatarKey } from "../lib/avatars";
import { profileKey, userWalletsKey } from "../lib/profiles";
import { clearAbout, ownedAbout, readAbout, setAbout, syncAbout } from "../lib/server/about";
import type { UserGate } from "../lib/server/gate";
import { joinClub, leaveClub, membershipsOfWallet, syncMemberships, walletMembershipsKey } from "../lib/server/members";
import { handlePrivyEvent } from "../lib/server/privyWebhook";
import { aboutHandlers, walletClubsHandler, walletProfileHandler } from "../lib/server/profilePageRoutes";
import { memoryStore } from "../lib/server/store";
import { makeRegistry, parseAssets } from "../lib/verifiedAssets";

const W1 = getAddress("0x00000000000000000000000000000000000000a1");
const W2 = getAddress("0x00000000000000000000000000000000000000b2");

describe("cleanAbout", () => {
  it("trims, collapses a name to one line and keeps a bio's line breaks", () => {
    const result = cleanAbout({ name: "  Ada \n  Lovelace ", bio: " line one \r\n\r\n\r\n\r\nline  two " });
    assert.deepEqual(result, { ok: true, about: { name: "Ada Lovelace", bio: "line one\n\nline two" } });
  });

  it("drops blank fields, so there is nothing to show", () => {
    assert.deepEqual(cleanAbout({ name: "  ", bio: "" }), { ok: true, about: {} });
    assert.deepEqual(cleanAbout({}), { ok: true, about: {} });
    assert.deepEqual(cleanAbout(null), { ok: true, about: {} });
  });

  it("strips controls, zero-width characters and bidi overrides", () => {
    const result = cleanAbout({ name: "a‮b​c\u0000d", bio: "x⁦y" });
    assert.deepEqual(result, { ok: true, about: { name: "abcd", bio: "xy" } });
  });

  it("counts characters, not UTF-16 units", () => {
    assert.equal(cleanAbout({ name: "🦊".repeat(NAME_MAX) }).ok, true);
    assert.equal(cleanAbout({ name: "🦊".repeat(NAME_MAX + 1) }).ok, false);
    assert.equal(cleanAbout({ bio: "b".repeat(BIO_MAX) }).ok, true);
    assert.equal(cleanAbout({ bio: "b".repeat(BIO_MAX + 1) }).ok, false);
  });

  it("refuses what isn't text", () => {
    assert.equal(cleanAbout({ name: 5 }).ok, false);
    assert.equal(cleanAbout({ bio: ["x"] }).ok, false);
  });
});

describe("the name and bio on the server", () => {
  it("is kept for each linked wallet, under the user", async () => {
    const store = memoryStore();
    const result = await setAbout(store, "u1", [W1, W2], { name: "Ada" }, 5);
    assert.deepEqual(result, { ok: true, about: { name: "Ada" }, wallets: [W1.toLowerCase(), W2.toLowerCase()] });
    for (const wallet of [W1, W2]) assert.deepEqual(await readAbout(store, wallet), { name: "Ada" });
    assert.equal((await store.get<StoredAbout>(aboutKey(W1)))?.userId, "u1");
  });

  it("needs a linked wallet", async () => {
    assert.deepEqual(await setAbout(memoryStore(), "u1", [], { name: "Ada" }), { ok: false, reason: "no_wallet" });
  });

  it("clears with an empty one", async () => {
    const store = memoryStore();
    await setAbout(store, "u1", [W1], { name: "Ada", bio: "hi" });
    const result = await setAbout(store, "u1", [W1], {});
    assert.deepEqual(result, { ok: true, about: {}, wallets: [W1.toLowerCase()] });
    assert.equal(await readAbout(store, W1), null);
    assert.deepEqual(await store.members(aboutWalletsKey("u1")), []);
  });

  it("shows nothing for a wallet that wrote nothing", async () => {
    assert.equal(await readAbout(memoryStore(), W1), null);
  });

  it("follows the linked wallets: an unlinked one loses it, a new one gets it", async () => {
    const store = memoryStore();
    await setAbout(store, "u1", [W1, W2], { bio: "hi" });
    await syncAbout(store, "u1", [W2]);
    assert.equal(await readAbout(store, W1), null);
    assert.deepEqual(await readAbout(store, W2), { bio: "hi" });
    await syncAbout(store, "u1", [W1, W2]);
    assert.deepEqual(await readAbout(store, W1), { bio: "hi" });
    await syncAbout(store, "u1", []);
    assert.equal(await readAbout(store, W2), null);
  });

  it("leaves a wallet that moved to another user alone", async () => {
    const store = memoryStore();
    await setAbout(store, "u1", [W1, W2], { name: "Ada" });
    await setAbout(store, "u2", [W1], { name: "Bob" });
    await syncAbout(store, "u1", [W2]);
    assert.deepEqual(await readAbout(store, W1), { name: "Bob" });
  });

  it("finds the user's own text through any wallet", async () => {
    const store = memoryStore();
    await setAbout(store, "u1", [W1], { name: "Ada" });
    assert.equal((await ownedAbout(store, "u1", [W2]))?.name, "Ada");
    await clearAbout(store, "u1");
    assert.equal(await ownedAbout(store, "u1", [W1, W2]), null);
  });

  it("is brought in line by the Privy webhook when a wallet is unlinked", async () => {
    const store = memoryStore();
    await setAbout(store, "u1", [W1, W2], { name: "Ada" });
    const accounts = [{ type: "wallet", chain_type: "ethereum", address: W2 }];
    await handlePrivyEvent({ type: "user.unlinked_account", user: { id: "u1" } }, store, async () => accounts);
    assert.equal(await readAbout(store, W1), null);
    assert.deepEqual(await readAbout(store, W2), { name: "Ada" });
  });
});

const user = (id: string, ...wallets: string[]) => ({
  id,
  linked_accounts: wallets.map((address) => ({ type: "wallet", chain_type: "ethereum", address })),
});
const gateFor = (store: ReturnType<typeof memoryStore>, who: ReturnType<typeof user>) => async (): Promise<UserGate> =>
  ({ store, user: who }) as unknown as UserGate;
const put = (body: unknown) => new Request("http://x/api/about", { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("/api/about", () => {
  it("saves the caller's text for the wallets Privy says are theirs, and reads it back", async () => {
    const store = memoryStore();
    const h = aboutHandlers({ gate: gateFor(store, user("u1", W1, W2)) });
    const saved = await h.PUT(put({ name: "  Ada ", bio: "Collector" }));
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { enabled: true, about: { name: "Ada", bio: "Collector" } });
    assert.deepEqual(await readAbout(store, W2), { name: "Ada", bio: "Collector" });
    assert.deepEqual(await (await h.GET(new Request("http://x/api/about"))).json(), { enabled: true, about: { name: "Ada", bio: "Collector" } });
  });

  it("answers what a user without a wallet can't do, and what is too long or isn't JSON", async () => {
    const store = memoryStore();
    const noWallet = aboutHandlers({ gate: gateFor(store, user("u1")) });
    assert.equal((await noWallet.PUT(put({ name: "Ada" }))).status, 422);
    const h = aboutHandlers({ gate: gateFor(store, user("u1", W1)) });
    assert.equal((await h.PUT(put({ name: "x".repeat(NAME_MAX + 1) }))).status, 422);
    assert.equal((await h.PUT(put("{nope"))).status, 400);
    assert.equal((await h.PUT(put({ bio: "x".repeat(5_000) }))).status, 413);
    assert.equal(await readAbout(store, W1), null);
  });

  it("passes a refused gate straight through", async () => {
    const refused = new Response("no", { status: 401 });
    const h = aboutHandlers({ gate: async () => refused });
    assert.equal(await h.GET(new Request("http://x")), refused);
    assert.equal(await h.PUT(put({})), refused);
  });
});

const ctx = (address: string) => ({ params: Promise.resolve({ address }) });

describe("/api/wallets/[address]/profile", () => {
  it("is what the owner shows: handle, avatar, name and bio", async () => {
    const store = memoryStore();
    await store.set(profileKey(W1), { provider: "twitter", handle: "ada", userId: "u1", updatedAt: 1 });
    await store.set(avatarKey(W1), { userId: "u1", version: 3, image: "https://img.example/a.png" });
    await setAbout(store, "u1", [W1], { name: "Ada", bio: "hi" });
    const get = walletProfileHandler({ store: () => store });
    const res = await get(new Request(`http://x/api/wallets/${W1}/profile`), ctx(W1.toUpperCase().replace("0X", "0x")));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /s-maxage/);
    assert.deepEqual(await res.json(), {
      enabled: true,
      profile: { provider: "twitter", handle: "ada" },
      avatar: { image: "https://img.example/a.png" },
      about: { name: "Ada", bio: "hi" },
    } satisfies WalletProfile);
  });

  it("is empty for a wallet that shows nothing, and never carries the owner's account", async () => {
    const store = memoryStore();
    const get = walletProfileHandler({ store: () => store });
    const res = await get(new Request("http://x"), ctx(W2));
    assert.deepEqual(await res.json(), { enabled: true, profile: null, avatar: null, about: null });
    await store.set(profileKey(W2), { provider: "discord", handle: "bob", userId: "secret-user", updatedAt: 1 });
    await setAbout(store, "secret-user", [W2], { name: "Bob" });
    const body = JSON.stringify(await (await get(new Request("http://x"), ctx(W2))).json());
    assert.ok(!body.includes("secret-user"));
  });

  it("is not cached when the owner asks for a fresh one", async () => {
    const get = walletProfileHandler({ store: () => memoryStore() });
    const res = await get(new Request("http://x/?fresh=1"), ctx(W1));
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("refuses what isn't an address, and says it is off without a store", async () => {
    const get = walletProfileHandler({ store: () => null });
    assert.equal((await get(new Request("http://x"), ctx("nope"))).status, 400);
    const off = await get(new Request("http://x"), ctx(W1));
    assert.equal(((await off.json()) as WalletProfile).enabled, false);
  });
});

describe("profilePath", () => {
  it("is the lowercase address", () => {
    assert.equal(profilePath(W1), `/profile/${W1.toLowerCase()}`);
  });
});

const NFT = "0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4";
const PETS = "0x0000000000000000000000000000000000000077";
const entry = (address: string) => ({ chainId: 10143, address, kind: "erc721", name: "Name", symbol: "SYM", status: "verified", note: "Why." });
const reg = makeRegistry(parseAssets([entry(NFT), entry(PETS)]));
const hold = { holdings: async () => [1n] };

describe("a wallet's Clubs", () => {
  it("lists the Clubs whose Members list shows the wallet, and only that wallet", async () => {
    const store = memoryStore();
    await joinClub(store, reg.clubFor(NFT)!, "u1", [W1, W2], { ...hold, now: () => 10 });
    await joinClub(store, reg.clubFor(PETS)!, "u1", [W1, W2], { ...hold, now: () => 20 });
    const shown = await membershipsOfWallet(store, W1);
    assert.deepEqual(shown.map((m) => m.token).sort(), [NFT.toLowerCase(), PETS.toLowerCase()].sort());
    assert.deepEqual(await membershipsOfWallet(store, W2), [], "a user's other wallets aren't tied to their Clubs");
  });

  it("follows the display wallet when it changes, and leaves with the Club", async () => {
    const store = memoryStore();
    await joinClub(store, reg.clubFor(NFT)!, "u1", [W1, W2], hold);
    // The user shares a profile on W2, so the Members list now shows W2.
    await store.set(profileKey(W2), { provider: "twitter", handle: "ada", userId: "u1", updatedAt: 1 });
    await store.setMembers(userWalletsKey("u1"), [W2.toLowerCase()]);
    await syncMemberships(store, "u1", [W1, W2]);
    assert.deepEqual(await membershipsOfWallet(store, W1), []);
    assert.equal((await membershipsOfWallet(store, W2)).length, 1);

    await leaveClub(store, NFT, "u1");
    assert.deepEqual(await membershipsOfWallet(store, W2), []);
    assert.deepEqual(await store.members(walletMembershipsKey(W2)), []);
  });

  it("is filled in for a membership made before the index, on the next sync", async () => {
    const store = memoryStore();
    await joinClub(store, reg.clubFor(NFT)!, "u1", [W1], hold);
    await store.del(walletMembershipsKey(W1));
    assert.deepEqual(await membershipsOfWallet(store, W1), []);
    await syncMemberships(store, "u1", [W1]);
    assert.equal((await membershipsOfWallet(store, W1)).length, 1);
  });

  it("is served newest join first, without user ids, and skips Clubs that left the list", async () => {
    const store = memoryStore();
    await joinClub(store, reg.clubFor(NFT)!, "u1", [W1], { holdings: async () => [1n], now: () => 10 });
    await joinClub(store, reg.clubFor(PETS)!, "u1", [W1], { holdings: async () => [0n], now: () => 20 });
    const ctx = (address: string) => ({ params: Promise.resolve({ address }) });
    const res = await walletClubsHandler({ store: () => store, registry: reg })(new Request("http://x"), ctx(W1.toUpperCase().replace("0X", "0x")));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      enabled: true,
      clubs: [
        { token: PETS.toLowerCase(), holder: false, joinedAt: 20 },
        { token: NFT.toLowerCase(), holder: true, joinedAt: 10 },
      ],
    });
    const onlyNft = makeRegistry(parseAssets([entry(NFT)]));
    const some = await walletClubsHandler({ store: () => store, registry: onlyNft })(new Request("http://x?fresh=1"), ctx(W1));
    assert.equal(some.headers.get("cache-control"), "no-store");
    assert.deepEqual(
      ((await some.json()) as { clubs: { token: string }[] }).clubs.map((c) => c.token),
      [NFT.toLowerCase()],
    );
  });

  it("refuses what isn't an address and says it is off without a store", async () => {
    const get = walletClubsHandler({ store: () => null });
    assert.equal((await get(new Request("http://x"), { params: Promise.resolve({ address: "nope" }) })).status, 400);
    const off = await get(new Request("http://x"), { params: Promise.resolve({ address: W1 }) });
    assert.deepEqual(await off.json(), { enabled: false, clubs: [] });
  });
});
