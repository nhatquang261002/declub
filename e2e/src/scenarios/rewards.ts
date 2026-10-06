import assert from "node:assert/strict";
import { type Abi, type Address, type Hex, parseEther, zeroAddress } from "viem";
import { REWARDS as REWARDS_ARTIFACT } from "../lib/artifacts.ts";
import type { Case } from "../lib/report.ts";
import type { World } from "../lib/world.ts";

/**
 * Club Rewards end to end (ADR 0022): a real swap pays the fee on a real chain, the app's own
 * activity log and epoch builder (web/lib/server/activity.ts, rewards.ts) work out who gets what,
 * the relayer publishes it on DeClubRewards, and Holders and the Owner claim. Local only: it warps
 * past the claim delay and window, and builds against an in-memory store.
 */

type Web = {
  memoryStore: () => unknown;
  recordActivity: (store: unknown, hash: Hex, receipt: unknown, options: unknown) => Promise<number>;
  readActivity: (store: unknown, token: string) => Promise<{ kind: string; fee?: string; at: number }[]>;
  joinClub: (store: unknown, entry: unknown, userId: string, wallets: string[], deps: unknown) => Promise<{ ok: boolean }>;
  saveRoles: (store: unknown, token: string, roles: { owner?: string; moderators: string[] }) => Promise<void>;
  buildEpoch: (store: unknown, n: number, deps: unknown) => Promise<{ status: string; record?: EpochRecord }>;
  parseAssets: (list: unknown) => unknown[];
  REWARDS: { holderBps: number; fundBps: number };
  rewardLeaf: (chainId: number, contract: Address, epoch: number, account: Address, amount: bigint) => Hex;
  buildMerkleTree: (leaves: readonly Hex[]) => { root: Hex; proofs: Hex[][] };
};
type EpochRecord = {
  root: Hex;
  total: string;
  clubs: { club: string; fees: string; holderPool: string; fundPool: string; paidHolders: string; paidFund: string }[];
  leaves: { account: Address; amount: string; proof: Hex[]; breakdown: { kind: string; amount: string }[] }[];
};

/** The app's server code, loaded with the web project's resolver (extensionless imports, `@/`). */
async function web(): Promise<Web> {
  const at = (p: string) => `../../../web/${p}`;
  await import(at("test/register.mjs"));
  const [store, activity, members, clubState, rewards, assets, shared, merkle] = await Promise.all([
    import(at("lib/server/store.ts")),
    import(at("lib/server/activity.ts")),
    import(at("lib/server/members.ts")),
    import(at("lib/server/clubState.ts")),
    import(at("lib/server/rewards.ts")),
    import(at("lib/verifiedAssets.ts")),
    import(at("lib/rewards.ts")),
    import(at("lib/merkle.ts")),
  ]);
  return { ...store, ...activity, ...members, ...clubState, ...rewards, ...assets, REWARDS: shared.REWARDS, rewardLeaf: shared.rewardLeaf, buildMerkleTree: merkle.buildMerkleTree } as Web;
}

const localOnly = (w: World) => (w.target !== "local" ? "warps the chain and deploys its own DeClubRewards: local only" : !w.rewards ? "no DeClubRewards deployed" : null);
const abi = () => REWARDS_ARTIFACT().abi as Abi;
const claims = (record: EpochRecord, epoch: bigint) =>
  record.leaves.map((l) => ({ epoch, account: l.account, amount: BigInt(l.amount), proof: l.proof }));

/** Built in RW-01, published and claimed by the later cases. */
let built: EpochRecord | undefined;

/** The same payouts as another epoch: a leaf names its epoch, so the tree is rebuilt with the app's code. */
async function sameLeavesFor(w: World, record: EpochRecord, epoch: number): Promise<{ root: Hex; claims: ReturnType<typeof claims> }> {
  const app = await web();
  const tree = app.buildMerkleTree(record.leaves.map((l) => app.rewardLeaf(w.chainId, w.rewards!, epoch, l.account, BigInt(l.amount))));
  return {
    root: tree.root,
    claims: record.leaves.map((l, i) => ({ epoch: BigInt(epoch), account: l.account, amount: BigInt(l.amount), proof: tree.proofs[i]! })),
  };
}

export const rewardCases: Case<World>[] = [
  {
    id: "RW-01",
    title: "A real swap's fee goes through the app's epoch builder: 40% to Holders by holdings, 20% to the Owner",
    skip: localOnly,
    async run(w, note) {
      const app = await web();
      const store = app.memoryStore();
      const [entry] = app.parseAssets([{ chainId: 10143, address: w.nft, kind: "erc721", name: "E2E Chog", symbol: "ECHOG", status: "verified", note: "e2e" }]);

      // Alice sells Bob an NFT for MON through the escrow: both sides pay the fee.
      const [sold] = await w.mintNfts(w.alice, 3);
      await w.approveAll(w.alice, w.v2);
      const fee = await w.v2Fee();
      const offered = [w.nftAsset(sold!)];
      const price = parseEther("0.001");
      const created = await w.send(w.alice, w.v2, w.abi.v2, "createTrade", [offered, [w.monAsset(price)], zeroAddress, (await w.now()) + 3600n], fee);
      const [ev] = w.events<{ tradeId: bigint }>(created, w.abi.v2, "TradeCreated", w.v2);
      const filled = await w.send(w.bob, w.v2, w.abi.v2, "fillTrade", [ev!.tradeId], price + fee);

      // The server records it as it would a report: from the receipt, with the fee it paid.
      const reader = {
        receipt: (hash: Hex) => w.pub.getTransactionReceipt({ hash }),
        timestamp: async (block: bigint) => Number((await w.pub.getBlock({ blockNumber: block })).timestamp),
        trade: (contract: Address, id: bigint) => w.read(contract, w.abi.v2, "getTrade", [id]),
        proposalAssets: async () => [],
      };
      const club = (t: string) => (t.toLowerCase() === w.nft.toLowerCase() ? w.nft : null);
      assert.equal(await app.recordActivity(store, filled.transactionHash, filled, { reader, contracts: [w.v2], clubOf: club }), 1);
      const events = await app.readActivity(store, w.nft);
      assert.equal(events.length, 1);
      assert.equal(events[0]!.fee, (2n * fee).toString(), "the activity log didn't keep the swap's fee");

      // Alice and Bob join holding NFTs; Carol, who holds none, is the Owner.
      const holdings = async (token: Address, wallets: readonly Address[]) =>
        Promise.all(wallets.map((a) => w.read<bigint>(token, w.abi.nft, "balanceOf", [a])));
      for (const [id, who] of [["ua", w.alice], ["ub", w.bob], ["uc", w.carol]] as const) {
        assert.ok((await app.joinClub(store, entry, id, [who.address.toLowerCase()], { holdings })).ok, `${who.name} joins`);
      }
      await app.saveRoles(store, w.nft, { owner: "uc", moderators: [] });

      const at = events[0]!.at;
      const result = await app.buildEpoch(store, 0, {
        now: () => at + 60,
        clubs: [entry],
        events: async () => events,
        holdings,
        chainId: w.chainId,
        contract: w.rewards,
        genesis: at - 10,
        length: 60,
      });
      assert.equal(result.status, "built");
      built = result.record!;

      const fees = 2n * fee;
      const holderPool = (fees * BigInt(app.REWARDS.holderBps)) / 10_000n;
      const fundPool = (fees * BigInt(app.REWARDS.fundBps)) / 10_000n;
      // Earlier scenarios may have left any of them holding NFTs: each holds what the chain says.
      const [a, b, c] = await holdings(w.nft, [w.alice.address, w.bob.address, w.carol.address]);
      const shares = a! + b! + c!;
      const amountOf = (who: Address) => BigInt(built!.leaves.find((l) => l.account === who)?.amount ?? "0");
      assert.equal(amountOf(w.alice.address), (holderPool * a!) / shares, "Alice's Holder share");
      assert.equal(amountOf(w.bob.address), (holderPool * b!) / shares, "Bob's Holder share");
      assert.equal(amountOf(w.carol.address), fundPool + (holderPool * c!) / shares, "the Owner's Club fund (plus any Holder share)");
      note(`fees ${w.fmt(fees)} MON; Holders ${w.fmt(holderPool)} over ${shares} NFTs (Alice ${a}, Bob ${b}, Carol ${c}); fund ${w.fmt(fundPool)} to Carol; root ${built.root}`);
    },
  },
  {
    id: "RW-02",
    title: "The relayer publishes the epoch; claims wait for the delay, pay each leaf once, and anyone can send them",
    skip: (w) => localOnly(w) ?? (built ? null : "RW-01 didn't build an epoch"),
    async run(w, note) {
      const record = built!;
      const total = BigInt(record.total);
      await w.expectRevert(w.alice, w.rewards!, abi(), "publish", [0n, record.root], "NotOperator", total);
      await w.send(w.relayer, w.rewards!, abi(), "publish", [0n, record.root], total);
      const all = claims(record, 0n);
      await w.expectRevert(w.dave, w.rewards!, abi(), "claimMany", [all], "NotOpenYet");

      await w.warp(3600);
      const before = await Promise.all(record.leaves.map((l) => w.monOf(l.account)));
      // Dave pays the gas; the MON goes to each account.
      await w.send(w.dave, w.rewards!, abi(), "claimMany", [all]);
      for (const [i, leaf] of record.leaves.entries()) {
        assert.equal((await w.monOf(leaf.account)) - before[i]!, BigInt(leaf.amount), `${leaf.account} wasn't paid its leaf`);
      }
      await w.expectRevert(w.dave, w.rewards!, abi(), "claim", [0n, all[0]!.account, all[0]!.amount, all[0]!.proof], "AlreadyClaimed");
      assert.equal(await w.monOf(w.rewards!), 0n, "the epoch should be fully paid out");
      note(`${record.leaves.length} leaves paid ${w.fmt(total)} MON in one claimMany`);
    },
  },
  {
    id: "RW-03",
    title: "A wrong root is revoked before claims open; an underfunded one can't overpay; the rest is swept after the window",
    skip: (w) => localOnly(w) ?? (built ? null : "RW-01 didn't build an epoch"),
    async run(w, note) {
      const record = built!;
      const total = BigInt(record.total);

      // Epoch 0's proofs don't verify in another epoch.
      const one = await sameLeavesFor(w, record, 1);
      const two = await sameLeavesFor(w, record, 2);
      assert.notEqual(one.root, record.root, "a leaf should be bound to its epoch");

      // Revoked before claims open: the relayer gets it all back, and the epoch can be published again.
      const before = await w.monOf(w.relayer.address);
      await w.send(w.relayer, w.rewards!, abi(), "publish", [1n, one.root], total);
      await w.send(w.relayer, w.rewards!, abi(), "revoke", [1n]);
      assert.ok(before - (await w.monOf(w.relayer.address)) < parseEther("0.01"), "revoke didn't refund (beyond gas)");

      // Underfunded (half): the epoch pays leaves only up to what it was sent.
      const half = total / 2n;
      await w.send(w.relayer, w.rewards!, abi(), "publish", [2n, two.root], half);
      await w.warp(3600);
      let paid = 0n;
      let refused = 0;
      for (const c of two.claims) {
        if (paid + c.amount <= half) {
          await w.send(w.dave, w.rewards!, abi(), "claim", [c.epoch, c.account, c.amount, c.proof]);
          paid += c.amount;
        } else {
          await w.expectRevert(w.dave, w.rewards!, abi(), "claim", [c.epoch, c.account, c.amount, c.proof], "OverClaim");
          refused++;
        }
      }
      assert.ok(refused > 0, "some leaf should have been refused");
      await w.expectRevert(w.relayer, w.rewards!, abi(), "sweep", [2n], "SweepTooEarly");
      await w.warp(86400);
      await w.send(w.relayer, w.rewards!, abi(), "sweep", [2n]);
      assert.equal(await w.monOf(w.rewards!), 0n, "sweep should leave nothing behind");
      note(`revoked epoch 1; epoch 2 paid ${w.fmt(paid)} of ${w.fmt(total)}, refused ${refused} leaf(s), swept ${w.fmt(half - paid)}`);
    },
  },
];
