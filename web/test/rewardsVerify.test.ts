import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAddress, type Address, type Hex } from "viem";
import { buildMerkleTree } from "../lib/merkle";
import { leavesOf, rewardLeaf, splitClub, type ClubInput, type EpochRecord } from "../lib/rewards";
import { carriedInFrom, merkleRoot, processProof, verifyEpochRecord, type VerifyInput } from "../lib/server/rewardsVerify";

const ETH = 10n ** 18n;
const CHAIN = 10143;
const REWARDS_AT: Address = getAddress("0x00000000000000000000000000000000000000ee");
const CLUB_A = "0x220a2c52fd27252e7cd6163a7bf1b6ae159d26e4";
const CLUB_B = "0x00000000000000000000000000000000000000c0";
const [alice, bob, carol, dave] = [
  "0xaaaa000000000000000000000000000000000001",
  "0xbbbb000000000000000000000000000000000002",
  "0xcccc000000000000000000000000000000000003",
  "0xdddd000000000000000000000000000000000004",
];
const N = 4;

/** A record built the way the epoch builder builds one, with what the check is given beside it. */
function fixture(): VerifyInput {
  const inputs: ClubInput[] = [
    {
      club: CLUB_A,
      fees: 10n * ETH,
      carried: { holders: 2n * ETH, fund: ETH },
      sponsored: 3n * ETH,
      holders: [
        { wallet: alice, shares: 3n, points: 12 },
        { wallet: bob, shares: 1n, points: 12 },
      ],
      owner: carol,
    },
    {
      club: CLUB_B,
      fees: 7n * ETH,
      carried: { holders: 0n, fund: 0n },
      holders: [
        { wallet: bob, shares: 2n, points: 12 },
        { wallet: dave, shares: 1n, points: 12 },
      ],
      owner: null,
    },
  ];
  const splits = inputs.map(splitClub);
  const leaves = leavesOf(splits);
  const hashes = leaves.map((l) => rewardLeaf(CHAIN, REWARDS_AT, N, l.account, l.amount));
  const tree = buildMerkleTree(hashes);
  const str = (x: bigint) => x.toString();
  const record: EpochRecord = {
    n: N,
    chainId: CHAIN,
    contract: REWARDS_AT,
    start: 0,
    end: 1,
    builtAt: 2,
    root: tree.root,
    total: str(leaves.reduce((sum, l) => sum + l.amount, 0n)),
    clubs: splits.map((s) => ({
      club: s.club,
      fees: str(s.fees),
      ...(s.sponsored > 0n ? { sponsored: str(s.sponsored) } : {}),
      holderPool: str(s.holderPool),
      fundPool: str(s.fundPool),
      paidHolders: str(s.paidHolders),
      paidFund: str(s.paidFund),
      carry: { holders: str(s.carry.holders), fund: str(s.carry.fund) },
      holderCount: s.holderCount,
    })),
    leaves: leaves.map((l, i) => ({
      account: l.account,
      amount: str(l.amount),
      proof: tree.proofs[i]!,
      breakdown: l.breakdown.map((b) => ({ club: b.club, kind: b.kind, amount: str(b.amount) })),
    })),
  };
  return {
    record,
    expected: { n: N, chainId: CHAIN, contract: REWARDS_AT },
    carriedIn: new Map([[CLUB_A, { holders: 2n * ETH, fund: ETH }]]),
    sponsored: new Map([[CLUB_A, 3n * ETH]]),
    leafHashes: hashes,
    previousTotal: 10n * ETH,
  };
}

/** The fixture with its record changed by `edit`. */
function tampered(edit: (record: EpochRecord, input: VerifyInput) => void): VerifyInput {
  const input = fixture();
  const record = structuredClone(input.record);
  edit(record, input);
  return { ...input, record };
}

const problemsOf = (input: VerifyInput) => verifyEpochRecord(input).problems;

describe("verifyEpochRecord", () => {
  it("passes an epoch as the builder makes it", () => {
    const result = verifyEpochRecord(fixture());
    assert.deepEqual(result.problems, []);
    assert.equal(
      result.notes.some((n) => n.includes("4 accounts")),
      true,
    );
  });

  it("agrees with the builder's tree, and its proofs open", () => {
    const { record, leafHashes } = fixture();
    assert.equal(merkleRoot(leafHashes), record.root);
    record.leaves.forEach((l, i) => assert.equal(processProof(l.proof, leafHashes[i]!), record.root));
  });

  it("fails a leaf whose amount was raised", () => {
    const input = tampered((r) => {
      r.leaves[0]!.amount = (BigInt(r.leaves[0]!.amount) + 1n).toString();
    });
    const problems = problemsOf(input);
    assert.ok(problems.some((p) => p.includes("breakdown adds up")));
    assert.ok(problems.some((p) => p.includes("the leaves add up")));
  });

  it("fails a raised amount even when the leaf hashes come from the raised record", () => {
    // What the contract's leaf() would return for the edited amount: the stored root no longer fits.
    const input = tampered((r, i) => {
      r.leaves[0]!.amount = (BigInt(r.leaves[0]!.amount) + ETH).toString();
      r.leaves[0]!.breakdown[0]!.amount = (BigInt(r.leaves[0]!.breakdown[0]!.amount) + ETH).toString();
      r.total = (BigInt(r.total) + ETH).toString();
      const hashes = [...i.leafHashes];
      hashes[0] = rewardLeaf(CHAIN, REWARDS_AT, N, r.leaves[0]!.account, BigInt(r.leaves[0]!.amount));
      i.leafHashes = hashes;
    });
    const problems = problemsOf(input);
    assert.ok(problems.some((p) => p.includes("not the record's")));
    assert.ok(problems.some((p) => p.includes("pays Holders")));
  });

  it("fails a swapped root", () => {
    const input = tampered((r) => {
      r.root = `0x${"ab".repeat(32)}` as Hex;
    });
    const problems = problemsOf(input);
    assert.ok(problems.some((p) => p.includes("not the record's")));
    assert.ok(problems.some((p) => p.includes("doesn't open")));
  });

  it("fails a broken proof", () => {
    const input = tampered((r) => {
      r.leaves[1]!.proof = [`0x${"11".repeat(32)}` as Hex, ...r.leaves[1]!.proof.slice(1)];
    });
    assert.deepEqual(problemsOf(input).length, 1);
    assert.ok(problemsOf(input)[0]!.includes("Leaf 1"));
  });

  it("fails a carry that doesn't match what's left", () => {
    const input = tampered((r) => {
      r.clubs[0]!.carry.holders = (BigInt(r.clubs[0]!.carry.holders) + ETH).toString();
    });
    assert.ok(problemsOf(input).some((p) => p.includes("rolls")));
  });

  it("fails a carry in that the earlier epoch doesn't back", () => {
    const input = fixture();
    const problems = problemsOf({ ...input, carriedIn: new Map() });
    assert.ok(problems.some((p) => p.includes("Holder pool is")));
    assert.ok(problems.some((p) => p.includes("fund pool is")));
  });

  it("fails a total that isn't the sum of the leaves", () => {
    const input = tampered((r) => {
      r.total = (BigInt(r.total) + 1n).toString();
    });
    const problems = problemsOf(input);
    assert.ok(problems.some((p) => p.includes("the leaves add up")));
    assert.ok(problems.some((p) => p.includes("pay out")));
  });

  it("fails an account with two leaves", () => {
    const input = tampered((r) => {
      r.leaves[1]!.account = r.leaves[0]!.account;
    });
    assert.ok(problemsOf(input).some((p) => p.includes("more than one leaf")));
  });

  it("fails sponsors' money the ledger doesn't have", () => {
    const input = fixture();
    const problems = problemsOf({ ...input, sponsored: new Map([[CLUB_A, ETH]]) });
    assert.ok(problems.some((p) => p.includes("sponsors ledger")));
  });

  it("fails a record bound to another contract, chain or epoch", () => {
    const input = fixture();
    const problems = problemsOf({ ...input, expected: { n: N + 1, chainId: 143, contract: getAddress("0x00000000000000000000000000000000000000ef") } });
    assert.equal(problems.filter((p) => p.startsWith("The record")).length, 3);
  });

  it("fails an unchecksummed or zero account", () => {
    const lower = tampered((r) => {
      r.leaves[0]!.account = r.leaves[0]!.account.toLowerCase() as Address;
    });
    assert.ok(problemsOf(lower).some((p) => p.includes("checksummed")));
  });
});

describe("carriedInFrom", () => {
  it("takes each Club's carry from the latest earlier epoch that lists it", () => {
    const at = (n: number, clubs: [string, string][]) =>
      ({ n, clubs: clubs.map(([club, holders]) => ({ club, carry: { holders, fund: "0" } })) }) as unknown as EpochRecord;
    const carried = carriedInFrom(
      [
        at(1, [
          [CLUB_A, "5"],
          [CLUB_B, "7"],
        ]),
        at(2, [[CLUB_A, "9"]]),
        at(3, [[CLUB_A, "11"]]),
      ],
      3,
    );
    assert.equal(carried.get(CLUB_A)?.holders, 9n);
    assert.equal(carried.get(CLUB_B)?.holders, 7n);
  });
});
