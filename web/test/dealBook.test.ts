import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress } from "viem";
import { erc20Asset, nativeAsset, nftAsset, type TokenInfo } from "../lib/assets";
import { bookParams, fromWireListings, pageBook, parseBookQuery, toWireListing, type BookQuery, type BookResponse, type BookSource } from "../lib/dealBook";
import { DEFAULT_FILTERS } from "../lib/dealFilters";
import { displayStatus } from "../lib/deals";
import type { DealV2 } from "../lib/dealsV2";
import { intentAsListing, intentHash, type PoolIntent } from "../lib/intents";
import { createBook, type BookReader } from "../lib/server/dealBook";
import { dealsHandler } from "../lib/server/dealRoutes";

const NOW = Math.floor(Date.now() / 1000);
const ME = getAddress("0x00000000000000000000000000000000000000a1");
const ANA = getAddress("0x00000000000000000000000000000000000000b2");
const BO = getAddress("0x00000000000000000000000000000000000000c3");
const NFT = getAddress("0x220a2C52FD27252e7Cd6163A7bF1b6ae159D26e4");
const USD = getAddress("0xd300f095f456D59AAc122B0100833fE195136F6c");
const TOADS = getAddress("0x00000000000000000000000000000000000000d4");

const deal = (id: number, over: Partial<DealV2> = {}): DealV2 => ({
  id: BigInt(id),
  maker: ANA,
  taker: null,
  expiry: 0n,
  status: "open",
  fee: 0n,
  offered: [nftAsset(NFT, BigInt(id))],
  requested: [nativeAsset(10n ** 18n)],
  ...over,
});

const query = (over: Partial<BookQuery> = {}): BookQuery => ({
  tab: "open",
  filters: DEFAULT_FILTERS,
  kind: "any",
  tokens: [],
  page: 1,
  size: 10,
  ...over,
});

const source = (deals: DealV2[], signed: PoolIntent[] = [], info: Map<string, TokenInfo> = new Map()): BookSource => ({
  deals,
  openSigned: signed.map(intentAsListing),
  allSigned: signed.map(intentAsListing),
  info,
});

/** A signed swap as the pool would return it, with the real hash of its terms. */
const signedRow = (n: number, maker = ANA): PoolIntent => {
  const intent = {
    maker,
    give: [nftAsset(NFT, BigInt(n))],
    want: [erc20Asset(USD, 100n)],
    feeToken: USD,
    maxFee: 10n,
    deadline: BigInt(NOW + 3_600),
    nonce: BigInt(n),
  };
  return { hash: intentHash(intent), status: "open", reason: null, createdAt: NOW - n * 600, settlementTx: null, intent, signature: `0x${"ab".repeat(65)}` };
};

const ids = (items: readonly { id: bigint }[]) => items.map((t) => Number(t.id));

describe("parseBookQuery", () => {
  it("reads what bookParams writes", () => {
    const q = query({
      tab: "all",
      filters: { query: "usd", mon: "wants-mon", sort: "ending-soon" },
      kind: "locked",
      viewer: ME,
      tokens: [NFT, USD],
      page: 3,
      size: 4,
    });
    assert.deepEqual(parseBookQuery(bookParams(q)), q);
  });

  it("fills in the defaults", () => {
    assert.deepEqual(parseBookQuery(new URLSearchParams()), query({ viewer: undefined }));
  });

  it("refuses what it can't use", () => {
    for (const bad of ["tab=mine", "mon=lots", "viewer=0x12", "page=0", "size=51", "token=0x1", `q=${"x".repeat(101)}`]) {
      assert.equal(typeof parseBookQuery(new URLSearchParams(bad)), "string", bad);
    }
    const three = new URLSearchParams([
      ["token", NFT],
      ["token", USD],
      ["token", TOADS],
    ]);
    assert.equal(typeof parseBookQuery(three), "string");
  });
});

describe("pageBook", () => {
  const book = [
    deal(6, { taker: ME }),
    deal(5, { taker: BO }),
    deal(4, { expiry: BigInt(NOW - 60) }),
    deal(3, { status: "filled" }),
    deal(2, { offered: [erc20Asset(USD, 5n)] }),
    deal(1, { expiry: BigInt(NOW + 600) }),
  ];

  it("shows live public deals, and private ones only to the wallet they name", () => {
    assert.deepEqual(ids(pageBook(source(book), query(), NOW).items), [2, 1]);
    const mine = pageBook(source(book), query({ viewer: ME }), NOW);
    assert.deepEqual(ids(mine.items), [6, 2, 1]);
    assert.deepEqual(mine.counts, { open: 3, forYou: 1 });
    assert.deepEqual(ids(pageBook(source(book), query({ viewer: ME, tab: "for-you" }), NOW).items), [6]);
    assert.deepEqual(ids(pageBook(source(book), query({ tab: "all" }), NOW).items), [6, 5, 4, 3, 2, 1]);
  });

  it("searches the whole book, by id and by token symbol", () => {
    const old = [...Array.from({ length: 500 }, (_, i) => deal(1_000 - i)), deal(7, { offered: [erc20Asset(USD, 5n)] })];
    const info = new Map([[USD.toLowerCase(), { symbol: "mUSD", decimals: 6 }]]);
    const found = (q: string) => ids(pageBook(source(old, [], info), query({ filters: { ...DEFAULT_FILTERS, query: q } }), NOW).items);
    assert.deepEqual(found("musd"), [7]);
    assert.deepEqual(found("#7"), [7]);
  });

  it("filters by token, on either side", () => {
    const withToads = [deal(3, { requested: [nftAsset(TOADS, 9n)] }), deal(2, { offered: [nftAsset(TOADS, 1n)] }), deal(1, { offered: [erc20Asset(USD, 1n)] })];
    assert.deepEqual(ids(pageBook(source(withToads), query({ tokens: [TOADS] }), NOW).items), [3, 2]);
  });

  it("puts signed swaps first, and drops either kind on request", () => {
    const rows = [signedRow(1), signedRow(2, ME), signedRow(3, BO)];
    const both = pageBook(source(book, rows), query(), NOW);
    assert.ok("signed" in both.items[0]);
    assert.equal(both.total, rows.length + 2);
    assert.equal(pageBook(source(book, rows), query({ kind: "locked" }), NOW).total, 2);
    assert.equal(pageBook(source(book, rows), query({ kind: "signed" }), NOW).total, rows.length);
  });

  it("pages, and counts every page", () => {
    const many = Array.from({ length: 9 }, (_, i) => deal(9 - i));
    const page = pageBook(source(many), query({ page: 3, size: 4 }), NOW);
    assert.deepEqual(ids(page.items), [1]);
    assert.equal(page.total, 9);
    assert.deepEqual(pageBook(source(many), query({ page: 4, size: 4 }), NOW).items, []);
  });

  it("sorts by ending soon across the book", () => {
    const page = pageBook(source(book), query({ filters: { ...DEFAULT_FILTERS, sort: "ending-soon" } }), NOW);
    assert.deepEqual(ids(page.items), [1, 2]);
  });
});

describe("the wire format", () => {
  it("round-trips deals and signed swaps through JSON", () => {
    const row = signedRow(1, ME);
    const items = [deal(3, { taker: ME, expiry: 99n, fee: 7n, offered: [erc20Asset(USD, 123n), nativeAsset(5n)] }), intentAsListing(row)];
    const back = fromWireListings(JSON.parse(JSON.stringify(items.map(toWireListing))));
    assert.deepEqual(back, items);
  });

  it("leaves out what doesn't read back, including a signed swap whose hash doesn't match", () => {
    const row = signedRow(1, ME);
    const forged = { signed: { ...JSON.parse(JSON.stringify(toWireListing(intentAsListing(row)))).signed, hash: `0x${"11".repeat(32)}` } };
    const broken = { deal: { ...JSON.parse(JSON.stringify(toWireListing(deal(1)))).deal, maker: "nobody" } };
    assert.deepEqual(fromWireListings([forged, broken, toWireListing(deal(2))]), [deal(2)]);
  });
});

/** A fake contract that counts what is read. */
function fakeReader(deals: DealV2[]) {
  const state = { deals, reads: [] as bigint[], counts: 0, tokenReads: [] as string[], fail: false };
  const reader: BookReader = {
    async tradeCount() {
      state.counts++;
      if (state.fail) throw new Error("rpc down");
      return BigInt(state.deals.length);
    },
    async trades(list) {
      state.reads.push(...list);
      return list.map((id) => state.deals.find((d) => d.id === id) ?? null);
    },
    async tokenInfo(tokens) {
      state.tokenReads.push(...tokens);
      return new Map(tokens.filter((t) => t === USD.toLowerCase()).map((t) => [t, { symbol: "mUSD", decimals: 6 }]));
    },
  };
  return { reader, state };
}

describe("createBook", () => {
  it("reads a closed deal once, and open deals on every refresh", async () => {
    let clock = 0;
    const { reader, state } = fakeReader([deal(1, { status: "filled" }), deal(2), deal(3, { status: "cancelled" })]);
    const book = createBook(reader, null, { ttlMs: 1_000, batch: 2, now: () => clock });
    assert.deepEqual(ids((await book.source("open")).deals), [3, 2, 1]);
    assert.deepEqual(state.reads.sort(), [1n, 2n, 3n]);

    state.reads = [];
    await book.source("open");
    assert.deepEqual(state.reads, [], "within the ttl nothing is read");

    clock = 2_000;
    state.deals = [...state.deals, deal(4)];
    assert.deepEqual(ids((await book.source("open")).deals), [4, 3, 2, 1]);
    assert.deepEqual(state.reads.sort(), [2n, 4n], "only open and new deals");
  });

  it("shares one refresh between requests that arrive together", async () => {
    const { reader, state } = fakeReader([deal(1)]);
    const book = createBook(reader, null);
    await Promise.all([book.source("open"), book.source("open"), book.source("all")]);
    assert.equal(state.counts, 1);
  });

  it("serves the last book when a refresh fails, and fails without one", async () => {
    let clock = 0;
    const { reader, state } = fakeReader([deal(1)]);
    const book = createBook(reader, null, { ttlMs: 1_000, now: () => clock });
    state.fail = true;
    await assert.rejects(book.source("open"));
    state.fail = false;
    await book.source("open");
    state.fail = true;
    clock = 5_000;
    assert.deepEqual(ids((await book.source("open")).deals), [1]);
  });

  it("reads each token's symbol once, and tries a silent one again later", async () => {
    let clock = 0;
    const silent = getAddress("0x00000000000000000000000000000000000000e5");
    const { reader, state } = fakeReader([deal(1, { offered: [erc20Asset(USD, 1n)], requested: [erc20Asset(silent, 1n)] })]);
    const book = createBook(reader, null, { ttlMs: 0, tokenRetryMs: 60_000, now: () => clock });
    const first = await book.source("open");
    assert.deepEqual(first.info.get(USD.toLowerCase()), { symbol: "mUSD", decimals: 6 });
    clock = 1_000;
    await book.source("open");
    assert.deepEqual(state.tokenReads, [USD.toLowerCase(), silent.toLowerCase()]);
    clock = 120_000;
    await book.source("open");
    assert.deepEqual(state.tokenReads.slice(2), [silent.toLowerCase()]);
  });

  it("keeps the deals when the pool is down, and says so", async () => {
    const { reader } = fakeReader([deal(1)]);
    const book = createBook(reader, async () => {
      throw new Error("Can't reach the intent pool.");
    });
    const result = await book.source("all");
    assert.deepEqual(ids(result.deals), [1]);
    assert.deepEqual(result.openSigned, []);
    assert.equal(result.signedError, "Can't reach the intent pool.");
  });
});

describe("GET /api/deals", () => {
  const get = (search = "") => new Request(`http://localhost/api/deals${search}`, { headers: { "x-forwarded-for": "203.0.113.20" } });

  it("answers a page of the book, publicly cacheable", async () => {
    const { reader } = fakeReader([deal(1), deal(2, { status: "filled" }), deal(3)]);
    const book = createBook(reader, null);
    const res = await dealsHandler({ book: () => book, now: () => NOW * 1000 })(get("?size=1"));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /s-maxage/);
    const body = (await res.json()) as BookResponse;
    assert.ok(body.enabled);
    assert.equal(body.total, 2);
    assert.deepEqual(ids(fromWireListings(body.items)), [3]);
  });

  it("refuses a bad query, and is off without a deal contract", async () => {
    const off = dealsHandler({ book: () => null });
    assert.equal((await off(get("?tab=nope"))).status, 400);
    assert.deepEqual(await (await off(get())).json(), { enabled: false });
  });
});

describe("intentAsListing", () => {
  it("shows a pool-expired intent as expired, like an expired locked deal", () => {
    const row = signedRow(1);
    const expired: PoolIntent = { ...row, status: "expired", intent: { ...row.intent, deadline: BigInt(NOW - 60) } };
    assert.equal(displayStatus(intentAsListing(expired), NOW), "expired");
    assert.equal(displayStatus(intentAsListing({ ...row, status: "cancelled" }), NOW), "cancelled");
    assert.equal(displayStatus(intentAsListing({ ...row, status: "settled" }), NOW), "filled");
  });
});
