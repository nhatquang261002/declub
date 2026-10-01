import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Address, getAddress } from "viem";
import {
  cancelDigest,
  covers,
  feeProblem,
  intentDigest,
  intentHash,
  shapeProblem,
} from "../src/intent.ts";
import { verifyEcdsa } from "../src/signature.ts";
import { AssetType, type Asset, type Intent } from "../src/types.ts";
import { WireError, intentFromWire, intentToWire } from "../src/wire.ts";
import { privateKeyToAccount } from "viem/accounts";

const A = getAddress("0x00000000000000000000000000000000000000a1");
const T = getAddress("0x00000000000000000000000000000000000000b2");
const U = getAddress("0x00000000000000000000000000000000000000c3");
const nft = (id: bigint, token = T): Asset => ({ assetType: AssetType.ERC721, token, id, amount: 1n });
const erc20 = (amount: bigint, token = U): Asset => ({
  assetType: AssetType.ERC20,
  token,
  id: 0n,
  amount,
});
const base: Intent = {
  maker: A,
  give: [nft(1n)],
  want: [erc20(5n)],
  feeToken: U,
  fee: 2n,
  deadline: 100n,
  nonce: 7n,
};

describe("wire codec", () => {
  it("round-trips an intent, including values past 2^53", () => {
    const big: Intent = { ...base, nonce: 2n ** 255n, give: [nft(2n ** 200n + 1n)] };
    assert.deepEqual(intentFromWire(JSON.parse(JSON.stringify(intentToWire(big)))), big);
  });

  it("rejects malformed input", () => {
    const w = intentToWire(base);
    assert.throws(() => intentFromWire({ ...w, nonce: 7 }), WireError);
    assert.throws(() => intentFromWire({ ...w, nonce: "-1" }), WireError);
    assert.throws(() => intentFromWire({ ...w, nonce: "07" }), WireError);
    assert.throws(() => intentFromWire({ ...w, nonce: (2n ** 256n).toString() }), WireError);
    assert.throws(() => intentFromWire({ ...w, deadline: (2n ** 64n).toString() }), WireError);
    assert.throws(() => intentFromWire({ ...w, maker: "0x12" }), WireError);
    assert.throws(() => intentFromWire({ ...w, feeToken: "0x12" }), WireError);
    assert.throws(() => intentFromWire({ ...w, fee: 2 }), WireError);
    assert.throws(() => intentFromWire({ ...w, fee: "-1" }), WireError);
    assert.throws(() => intentFromWire({ ...w, fee: (2n ** 256n).toString() }), WireError);
    assert.throws(() => intentFromWire({ ...w, give: "nope" }), WireError);
    assert.throws(() => intentFromWire({ ...w, give: [{ ...w.give[0], assetType: 256 }] }), WireError);
    assert.throws(() => intentFromWire(null), WireError);
  });
});

describe("shapeProblem", () => {
  it("accepts a good intent", () => assert.equal(shapeProblem(base), null));

  it("mirrors the contract's rules", () => {
    const bad = (patch: Partial<Intent>) => shapeProblem({ ...base, ...patch });
    assert.match(bad({ deadline: 0n })!, /deadline/);
    assert.match(bad({ give: [] })!, /empty/);
    assert.match(bad({ want: Array.from({ length: 11 }, (_, i) => nft(BigInt(i))) })!, /more than 10/);
    assert.match(bad({ give: [{ ...erc20(1n), assetType: AssetType.Native }] })!, /only ERC-20/);
    assert.match(bad({ give: [erc20(0n)] })!, /amount > 0/);
    assert.match(bad({ give: [{ ...erc20(1n), id: 1n }] })!, /id 0/);
    assert.match(bad({ give: [{ ...nft(1n), amount: 2n }] })!, /amount 1/);
    assert.match(bad({ give: [nft(1n), nft(1n)] })!, /duplicate/);
    assert.match(bad({ want: [nft(1n)] })!, /both sides/);
    assert.match(bad({ maker: "0x0000000000000000000000000000000000000000" })!, /zero/);
  });
});

describe("feeProblem", () => {
  const terms = { token: U, amount: 2n };

  it("accepts the contract's fee and nothing else", () => {
    assert.equal(feeProblem(base, terms), null);
    assert.match(feeProblem({ ...base, fee: 1n }, terms)!, /fee must be 2/);
    assert.match(feeProblem({ ...base, fee: 3n }, terms)!, /fee must be 2/);
    assert.match(feeProblem({ ...base, feeToken: T }, terms)!, /fee must be 2/);
  });

  it("compares the token without regard to case", () => {
    assert.equal(feeProblem({ ...base, feeToken: getAddress(U.toLowerCase()) }, terms), null);
  });
});

describe("covers", () => {
  it("compares ERC-20 amounts as a floor and NFTs exactly", () => {
    assert.ok(covers([erc20(10n)], [erc20(10n)]));
    assert.ok(covers([erc20(11n)], [erc20(10n)]));
    assert.ok(!covers([erc20(9n)], [erc20(10n)]));
    assert.ok(covers([nft(1n), erc20(1n)], [nft(1n)]));
    assert.ok(!covers([nft(2n)], [nft(1n)]));
    assert.ok(!covers([nft(1n, U)], [nft(1n, T)]));
  });
});

describe("hashing", () => {
  it("changes with any signed field", () => {
    const h = intentHash(base);
    for (const patch of [
      { nonce: 8n },
      { fee: 3n },
      { feeToken: T },
      { deadline: 101n },
      { want: [erc20(6n)] },
      { give: [nft(2n)] },
    ] as Partial<Intent>[]) {
      assert.notEqual(intentHash({ ...base, ...patch }), h);
    }
  });

  it("binds the digest to chain and contract", () => {
    const d = intentDigest(10143, T, base);
    assert.notEqual(intentDigest(1, T, base), d);
    assert.notEqual(intentDigest(10143, U, base), d);
    assert.notEqual(cancelDigest(10143, T, intentHash(base)), d);
  });
});

describe("verifyEcdsa", () => {
  const acct = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const digest = intentDigest(10143, T, { ...base, maker: acct.address });

  it("accepts the maker's signature and nobody else's", async () => {
    const sig = await acct.sign({ hash: digest });
    assert.ok(await verifyEcdsa(acct.address, digest, sig));
    assert.ok(!(await verifyEcdsa(A, digest, sig)));
    assert.ok(!(await verifyEcdsa(acct.address, intentDigest(10143, T, base), sig)));
  });

  it("rejects a malleable (high-s) twin, a bad v, and the wrong length", async () => {
    const sig = await acct.sign({ hash: digest });
    const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const s = BigInt(`0x${sig.slice(66, 130)}`);
    const v = Number(`0x${sig.slice(130)}`);
    const twin =
      `${sig.slice(0, 66)}${(N - s).toString(16).padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}` as `0x${string}`;
    assert.ok(!(await verifyEcdsa(acct.address, digest, twin)), "high-s twin");
    assert.ok(!(await verifyEcdsa(acct.address, digest, `${sig.slice(0, 130)}00` as `0x${string}`)));
    assert.ok(!(await verifyEcdsa(acct.address, digest, sig.slice(0, 130) as `0x${string}`)));
  });
});
