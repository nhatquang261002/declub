import { getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { erc20Asset, nativeAsset, nftAsset, type Asset, type TokenInfo } from "./assets";
import { CHOG_ADDRESS, DEMO_DEALS, ON_DEAL_V2_ADDRESS } from "./config";
import type { DealV2 } from "./dealsV2";
import { intentHash, type IntentStatus, type PoolIntent, type Settlement } from "./intents";
import type { ProposalV2 } from "./proposals";

/**
 * Mock deals for development, so every deal screen can be seen in every state without a wallet,
 * testnet deals, the deal contract or the intent pool: deals (exact swaps, open offers with offers
 * on them, private offers, a big bundle), and signed swaps including a settled ring of three. With a wallet connected, some are made by it or addressed
 * to it, so the maker's and the taker's views show too.
 *
 * They replace the live lists while NEXT_PUBLIC_DEMO_DEALS is on (the default outside production;
 * `=false` turns them off). Their ids (9000 and up) and token addresses are made up: no deal or
 * contract lives there, and useTxFlow refuses to send a write for one (MockWriteError).
 */
export { DEMO_DEALS };

/** One clock for every mock deal, so countdowns tick instead of being rebuilt from "now". */
const T0 = Math.floor(Date.now() / 1000);
const at = (offsetSec: number) => BigInt(T0 + offsetSec);
const HOUR = 3_600;
const DAY = 86_400;

const mon = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
const units = (n: number, decimals: number) => BigInt(Math.round(n * 100)) * 10n ** BigInt(decimals) / 100n;

/** A made-up but valid address, from a short label. */
const addr = (label: string): Address => getAddress(keccak256(toHex(`on-deal demo ${label}`)).slice(0, 42));

/** Other traders. `you` stands in for the viewer when no wallet is connected. */
const W = {
  ana: addr("ana"),
  bo: addr("bo"),
  cy: addr("cy"),
  dee: addr("dee"),
  eli: addr("eli"),
  fen: addr("fen"),
  gus: addr("gus"),
  you: addr("you"),
};

export const DEMO_TOKENS = {
  usdm: addr("token USDM"),
  gmonad: addr("token GMONAD"),
  wmon: addr("token WMON"),
  toads: addr("collection TOADZ"),
};

const TOKEN_INFO: Record<string, TokenInfo> = {
  [DEMO_TOKENS.usdm.toLowerCase()]: { symbol: "USDM", decimals: 6 },
  [DEMO_TOKENS.gmonad.toLowerCase()]: { symbol: "GMONAD", decimals: 18 },
  [DEMO_TOKENS.wmon.toLowerCase()]: { symbol: "WMON", decimals: 18 },
};

/** Symbol and decimals for a mock token, which has no contract to read them from. */
export const demoTokenInfo = (token: string): TokenInfo | undefined => TOKEN_INFO[token.toLowerCase()];

const usdm = (n: number) => erc20Asset(DEMO_TOKENS.usdm, units(n, 6));
const gmonad = (n: number) => erc20Asset(DEMO_TOKENS.gmonad, units(n, 18));
const wmon = (n: number) => erc20Asset(DEMO_TOKENS.wmon, units(n, 18));
const chog = (id: number) => nftAsset(CHOG_ADDRESS, BigInt(id));
const toad = (id: number) => nftAsset(DEMO_TOKENS.toads, BigInt(id));

/** The Chogs with artwork in /public/art/chogs, so mock deals don't wait on tokenURI. */
const CHOGS = { a: 1159, b: 1376, c: 143, d: 67, e: 909 } as const;

const FEE = mon(0.01);

// ─────────────────────────────────────────────────────────────── V2 (any assets)

type DemoV2 = DealV2 & { note?: string };

function demoV2(me?: Address): DemoV2[] {
  const you = me ?? W.you;
  const deal = (d: Omit<DemoV2, "fee"> & { fee?: bigint }): DemoV2 => ({ fee: FEE, ...d });
  return [
    deal({ id: 9112n, maker: W.ana, taker: null, expiry: at(2 * DAY), status: "open", offered: [chog(CHOGS.a), usdm(250)], requested: [chog(CHOGS.b), nativeAsset(mon(1.5))] }),
    deal({
      id: 9111n,
      maker: W.bo,
      taker: null,
      expiry: at(5 * HOUR),
      status: "open",
      offered: [chog(CHOGS.c), chog(CHOGS.e)],
      requested: [],
      note: "Looking for a crowned Chog, or about 3 MON.\nBundles with tokens welcome!",
    }),
    deal({
      id: 9110n,
      maker: you,
      taker: null,
      expiry: at(3 * DAY),
      status: "open",
      offered: [toad(42), gmonad(5_000)],
      requested: [],
      note: "Make me an offer. Chogs preferred.",
    }),
    deal({ id: 9109n, maker: W.cy, taker: you, expiry: at(9 * HOUR), status: "open", offered: [gmonad(1_000), chog(CHOGS.d)], requested: [nativeAsset(mon(2))] }),
    deal({ id: 9108n, maker: you, taker: null, expiry: at(DAY), status: "open", offered: [nativeAsset(mon(2))], requested: [toad(7)] }),
    deal({ id: 9107n, maker: W.dee, taker: null, expiry: at(40 * 60), status: "open", offered: [usdm(50)], requested: [chog(CHOGS.e)] }),
    deal({
      id: 9106n,
      maker: W.eli,
      taker: null,
      expiry: 0n,
      status: "open",
      offered: [chog(CHOGS.a), chog(CHOGS.b), chog(CHOGS.c), chog(CHOGS.d), toad(3), usdm(1_200), gmonad(25_000), wmon(4)],
      requested: [nativeAsset(mon(10))],
    }),
    deal({ id: 9105n, maker: W.fen, taker: W.gus, expiry: at(DAY), status: "open", offered: [chog(CHOGS.b)], requested: [usdm(400)] }),
    deal({ id: 9104n, maker: W.gus, taker: null, expiry: at(-3 * HOUR), status: "open", offered: [toad(19)], requested: [gmonad(2_500)] }),
    deal({ id: 9103n, maker: W.ana, taker: null, expiry: at(DAY), status: "filled", offered: [chog(CHOGS.b)], requested: [nativeAsset(mon(4))] }),
    deal({ id: 9102n, maker: you, taker: null, expiry: at(DAY), status: "filled", offered: [usdm(800)], requested: [chog(CHOGS.d)] }),
    deal({ id: 9101n, maker: W.bo, taker: null, expiry: at(2 * DAY), status: "cancelled", offered: [chog(CHOGS.e), wmon(1)], requested: [toad(11)] }),
  ];
}

export function demoDealsV2(me?: Address): DealV2[] {
  return demoV2(me).map((d) => {
    const deal: DemoV2 = { ...d };
    delete deal.note;
    return deal;
  });
}

/** One mock V2 deal and its open-offer note, or undefined for an id that isn't mock. */
export function demoDealV2(id: bigint, me?: Address): { deal: DealV2; note: string } | undefined {
  const found = demoV2(me).find((d) => d.id === id);
  if (!found) return undefined;
  const { note = "", ...deal } = found;
  return { deal, note };
}

/** Offers on the mock open offers, newest first. */
export function demoProposals(dealId: bigint, me?: Address): ProposalV2[] {
  const you = me ?? W.you;
  const offer = (id: number, proposer: Address, status: ProposalV2["status"], assets: Asset[]): ProposalV2 => ({
    dealId,
    id: BigInt(id),
    proposer,
    status,
    assets,
  });
  if (dealId === 9111n) {
    return [
      offer(4, you, "active", [chog(CHOGS.d), usdm(40)]),
      offer(3, W.cy, "active", [nativeAsset(mon(2.8))]),
      offer(2, W.dee, "active", [chog(CHOGS.a)]),
      offer(1, W.eli, "rejected", [gmonad(900)]),
      offer(0, W.fen, "withdrawn", [nativeAsset(mon(1))]),
    ];
  }
  if (dealId === 9110n) {
    return [
      offer(2, W.ana, "active", [chog(CHOGS.b), nativeAsset(mon(0.5))]),
      offer(1, W.gus, "active", [usdm(300)]),
      offer(0, W.bo, "rejected", [wmon(0.5)]),
    ];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────── Signed swaps

function intentRow(
  n: number,
  maker: Address,
  status: IntentStatus,
  give: Asset[],
  want: Asset[],
  deadline: bigint,
  extra: Partial<Pick<PoolIntent, "reason" | "settlementTx">> = {},
): PoolIntent {
  const intent = { maker, give, want, feeToken: DEMO_TOKENS.wmon, maxFee: FEE, deadline, nonce: BigInt(n) };
  return {
    // The real hash of the terms, so a mock row passes the same check a pool's row does.
    hash: intentHash(intent),
    status,
    reason: extra.reason ?? null,
    createdAt: T0 - n * 600,
    settlementTx: extra.settlementTx ?? null,
    intent,
    signature: `0x${"ab".repeat(65)}`,
  };
}

const RING_TX: Hex = keccak256(toHex("on-deal demo ring settlement"));
const PAIR_TX: Hex = keccak256(toHex("on-deal demo pair settlement"));

export function demoIntents(me?: Address): PoolIntent[] {
  const you = me ?? W.you;
  return [
    intentRow(1, W.ana, "open", [chog(CHOGS.c)], [usdm(100)], at(5 * HOUR)),
    intentRow(2, you, "open", [gmonad(500)], [chog(CHOGS.e)], at(20 * HOUR)),
    intentRow(3, W.cy, "open", [toad(5), usdm(20)], [gmonad(1_500)], at(45 * 60)),
    intentRow(4, you, "stale", [chog(CHOGS.a)], [usdm(180)], at(2 * DAY), {
      reason: "The approval for this NFT was revoked, so it can't move.",
    }),
    // A ring of three: Ana's Chog to Bo, Bo's tokens to you, your Toad to Ana.
    intentRow(5, W.ana, "settled", [chog(CHOGS.b)], [toad(8)], at(DAY), { settlementTx: RING_TX }),
    intentRow(6, W.bo, "settled", [usdm(220)], [chog(CHOGS.b)], at(DAY), { settlementTx: RING_TX }),
    intentRow(7, you, "settled", [toad(8)], [usdm(200)], at(DAY), { settlementTx: RING_TX }),
    // A plain pair.
    intentRow(8, W.dee, "settled", [chog(CHOGS.d)], [gmonad(3_000)], at(DAY), { settlementTx: PAIR_TX }),
    intentRow(9, W.eli, "settled", [gmonad(3_200)], [chog(CHOGS.d)], at(DAY), { settlementTx: PAIR_TX }),
    intentRow(10, W.fen, "expired", [usdm(60)], [toad(2)], at(-HOUR)),
    intentRow(11, W.gus, "cancelled", [chog(CHOGS.e)], [wmon(2)], at(DAY)),
  ];
}

export function demoSettlements(me?: Address): Settlement[] {
  const rows = demoIntents(me);
  const cycle = (tx: Hex) => rows.filter((r) => r.settlementTx === tx);
  return [
    { txHash: RING_TX, blockNumber: 0, at: T0 - 1_800, cycle: cycle(RING_TX) },
    { txHash: PAIR_TX, blockNumber: 0, at: T0 - 7_200, cycle: cycle(PAIR_TX) },
  ];
}

// ─────────────────────────────────────────────────────────────── Writes

const DEMO_IDS = new Set(demoV2().map((d) => d.id));

/** A mock deal's id, which no contract knows. */
export const isDemoDealId = (id: bigint) => DEMO_DEALS && DEMO_IDS.has(id);

/**
 * Whether a write is for a mock deal, so nothing should be sent: a deal call whose first argument
 * is a mock id, or any call to the V2 contract while mock deals stand in for an unset one.
 */
export function isDemoWrite(call: { address?: Address; args?: readonly unknown[] }): boolean {
  if (!DEMO_DEALS) return false;
  if (!call.address) return true;
  const deal = !!ON_DEAL_V2_ADDRESS && sameAddr(call.address, ON_DEAL_V2_ADDRESS);
  const first = call.args?.[0];
  return deal && typeof first === "bigint" && DEMO_IDS.has(first);
}

const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
