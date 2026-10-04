/**
 * Read-only checks of a deployment: safe against mainnet, needs no key and sends nothing.
 *
 *   node src/verify.ts                 the addresses in the root .env
 *   node src/verify.ts --mainnet       stricter: an EOA fee admin, a missing expectation, demo
 *                                      flags or a default Chog collection fail instead of warn
 *
 * Expectations (optional; checked when set): EXPECT_FEE_WEI, EXPECT_MAX_FEE_WEI,
 * EXPECT_FEE_RECIPIENT, EXPECT_FEE_ADMIN, EXPECT_FEE_TOKEN, EXPECT_CHAIN_ID.
 * Writes e2e/results/verify-<time>.{json,md}. Exits 1 if anything failed.
 */
import assert from "node:assert/strict";
import {
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  formatEther,
  hashDomain,
  http,
  isAddressEqual,
  zeroAddress,
} from "viem";
import { type Artifact, INTENTS, MOCK_WMON, V2 } from "./lib/artifacts.ts";
import { addr, arg, big, loadRootEnv, needAddr, str } from "./lib/env.ts";
import { type Case, Warning, finish, runCases } from "./lib/report.ts";
import { DOMAIN_NAME, DOMAIN_VERSION } from "./lib/world.ts";

loadRootEnv();
const mainnet = arg("mainnet") !== undefined;

interface Ctx {
  pub: PublicClient;
  chainId: number;
  v2: Address;
  intents: Address;
  poolUrl?: string;
  v2Art: Artifact;
  intentsArt: Artifact;
}

/** A finding that fails on mainnet and warns elsewhere. */
function strict(message: string): never {
  if (mainnet) throw new Error(message);
  throw new Warning(message);
}

const read = <T>(c: Ctx, address: Address, abi: Abi, functionName: string, args: unknown[] = []) =>
  c.pub.readContract({ address, abi, functionName, args }) as Promise<T>;

/** Runtime code equals the build's, with the constructor-filled immutable ranges blanked on both sides. */
function sameCode(onChain: Hex, art: Artifact): { ok: boolean; at?: number; sizes: string } {
  const a = Buffer.from(onChain.slice(2), "hex");
  const b = Buffer.from(art.deployedBytecode.slice(2), "hex");
  for (const { start, length } of art.immutables) {
    a.fill(0, start, start + length);
    b.fill(0, start, start + length);
  }
  const sizes = `${a.length} bytes on chain, ${b.length} in the build`;
  if (a.length !== b.length) return { ok: false, sizes };
  const at = a.findIndex((x, i) => x !== b[i]);
  return at === -1 ? { ok: true, sizes } : { ok: false, at, sizes };
}

async function feeConfig(c: Ctx, address: Address, abi: Abi) {
  const [fee, max, limit, recipient, admin, pending, pendingAt, pendingAdmin, delay] = await Promise.all([
    read<bigint>(c, address, abi, "fee"),
    read<bigint>(c, address, abi, "MAX_FEE"),
    read<bigint>(c, address, abi, "MAX_FEE_LIMIT"),
    read<Address>(c, address, abi, "FEE_RECIPIENT"),
    read<Address>(c, address, abi, "feeAdmin"),
    read<bigint>(c, address, abi, "pendingFee"),
    read<bigint>(c, address, abi, "pendingFeeAt"),
    read<Address>(c, address, abi, "pendingFeeAdmin"),
    read<bigint>(c, address, abi, "FEE_RAISE_DELAY"),
  ]);
  return { fee, max, limit, recipient, admin, pending, pendingAt, pendingAdmin, delay };
}

const isContract = async (c: Ctx, a: Address) => ((await c.pub.getCode({ address: a })) ?? "0x") !== "0x";

const cases: Case<Ctx>[] = [
  {
    id: "DEP-01",
    title: "The RPC serves the expected chain",
    async run(c, note) {
      const expected = Number(str("EXPECT_CHAIN_ID", str("NEXT_PUBLIC_CHAIN_ID", "10143")));
      note(`chain ${c.chainId}, head ${await c.pub.getBlockNumber()}`);
      assert.equal(c.chainId, expected, `RPC is on chain ${c.chainId}, expected ${expected}`);
    },
  },
  {
    id: "DEP-02",
    title: "Deployed code is this checkout's build (immutables masked)",
    async run(c, note) {
      const problems: string[] = [];
      for (const [name, address, art] of [["OnDealV2", c.v2, c.v2Art], ["OnDealIntents", c.intents, c.intentsArt]] as const) {
        const code = await c.pub.getCode({ address });
        if (!code || code === "0x") {
          problems.push(`${name} ${address}: no code`);
          continue;
        }
        const r = sameCode(code, art);
        note(`${name}: ${r.ok ? "matches" : "DIFFERS"} (${r.sizes}${r.at !== undefined ? `, first difference at byte ${r.at}` : ""})`);
        if (!r.ok) problems.push(`${name} ${address} is not the current source: redeploy, or check out the commit it was deployed from`);
      }
      assert.equal(problems.length, 0, problems.join("\n"));
    },
  },
  {
    id: "DEP-03",
    title: "Fee settings: within the ceiling, as expected, admin a separate contract, nothing pending",
    async run(c, note) {
      const fails: string[] = [];
      const warns: string[] = [];
      for (const [name, address, abi] of [["OnDealV2", c.v2, c.v2Art.abi], ["OnDealIntents", c.intents, c.intentsArt.abi]] as const) {
        const f = await feeConfig(c, address, abi);
        note(`${name}: fee ${formatEther(f.fee)}, ceiling ${formatEther(f.max)}, recipient ${f.recipient}, admin ${f.admin}`);
        if (f.fee > f.max) fails.push(`${name}: fee above the ceiling`);
        if (f.max > f.limit) fails.push(`${name}: ceiling above MAX_FEE_LIMIT`);
        if (f.max > 0n && f.recipient === zeroAddress) fails.push(`${name}: no fee recipient`);
        const expect: [string, bigint | Address | undefined, bigint | Address][] = [
          ["EXPECT_FEE_WEI", big("EXPECT_FEE_WEI"), f.fee],
          ["EXPECT_MAX_FEE_WEI", big("EXPECT_MAX_FEE_WEI"), f.max],
          ["EXPECT_FEE_RECIPIENT", addr("EXPECT_FEE_RECIPIENT"), f.recipient],
          ["EXPECT_FEE_ADMIN", addr("EXPECT_FEE_ADMIN"), f.admin],
        ];
        for (const [k, want, got] of expect) {
          if (want === undefined) {
            if (mainnet) fails.push(`${k} is not set: on mainnet every fee setting is checked against what was agreed`);
            continue;
          }
          if (String(want).toLowerCase() !== String(got).toLowerCase()) fails.push(`${name}: ${k} is ${want}, on chain ${got}`);
        }
        if (f.admin === zeroAddress) {
          if (f.max > 0n) warns.push(`${name}: no fee admin, so the fee is fixed for good`);
        } else {
          if (isAddressEqual(f.admin, f.recipient)) fails.push(`${name}: the fee admin is the recipient; ADR 0018 keeps them apart`);
          if (!(await isContract(c, f.admin))) warns.push(`${name}: fee admin ${f.admin} is an EOA, not a Safe`);
        }
        if (f.max > 0n && !(await isContract(c, f.recipient))) warns.push(`${name}: fee recipient ${f.recipient} is an EOA, not a Safe`);
        if (f.pending !== 0n) warns.push(`${name}: a raise to ${formatEther(f.pending)} is queued (from ${new Date(Number(f.pendingAt) * 1000).toISOString()})`);
        if (f.pendingAdmin !== zeroAddress) warns.push(`${name}: an admin handover to ${f.pendingAdmin} is pending`);
        if (f.delay !== 7n * 24n * 3600n) fails.push(`${name}: FEE_RAISE_DELAY is ${f.delay}s, not 7 days`);
      }
      assert.equal(fails.length, 0, fails.join("\n"));
      if (warns.length) strict(warns.join("\n"));
    },
  },
  {
    id: "DEP-04",
    title: "The intents fee token wraps MON like WMON (18 decimals, deposit, withdraw guarded)",
    async run(c, note) {
      const token = await read<Address>(c, c.intents, c.intentsArt.abi, "FEE_TOKEN");
      const max = await read<bigint>(c, c.intents, c.intentsArt.abi, "MAX_FEE");
      if (max === 0n && token === zeroAddress) return note("no fee: no fee token");
      const abi = MOCK_WMON().abi;
      const [decimals, symbol] = await Promise.all([
        read<number>(c, token, abi, "decimals"),
        read<string>(c, token, abi, "symbol"),
      ]);
      note(`${symbol} ${token}, ${decimals} decimals`);
      assert.equal(Number(decimals), 18, "fee token is not 18 decimals");
      const expected = addr("EXPECT_FEE_TOKEN");
      if (expected) assert.ok(isAddressEqual(expected, token), `FEE_TOKEN is ${token}, expected ${expected}`);
      else if (mainnet) assert.fail("EXPECT_FEE_TOKEN is not set: on mainnet the fee token must be the canonical WMON");
      // A wrap from a funded stranger succeeds; an unwrap from an empty one doesn't. Nothing is sent.
      const stranger = "0x00000000000000000000000000000000000e2e01" as Address;
      await c.pub.simulateContract({
        account: stranger, address: token, abi, functionName: "deposit", value: 1n,
        stateOverride: [{ address: stranger, balance: 10n ** 18n }],
      });
      await assert.rejects(
        c.pub.simulateContract({ account: stranger, address: token, abi, functionName: "withdraw", args: [1n] }),
        "withdraw from an empty balance should revert",
      );
    },
  },
  {
    id: "DEP-05",
    title: `Intents EIP-712 domain is ("${DOMAIN_NAME}", "${DOMAIN_VERSION}"), as the app and matcher sign`,
    async run(c, note) {
      const onChain = await read<Hex>(c, c.intents, c.intentsArt.abi, "DOMAIN_SEPARATOR");
      const ours = hashDomain({
        domain: { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId: BigInt(c.chainId), verifyingContract: c.intents },
        types: { EIP712Domain: [
          { name: "name", type: "string" }, { name: "version", type: "string" },
          { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
        ] },
      });
      let named = "";
      try {
        const d = await read<[Hex, string, string]>(c, c.intents, c.intentsArt.abi, "eip712Domain");
        named = ` (contract says "${d[1]}", "${d[2]}")`;
      } catch {}
      note(`DOMAIN_SEPARATOR ${onChain}${named}`);
      assert.equal(onChain, ours, `domain mismatch${named}: every signed swap from the app would fail BadSignature`);
    },
  },
  {
    id: "DEP-06",
    title: "Both contracts charge the same fee, ceiling, recipient and admin",
    async run(c) {
      const [a, b] = await Promise.all([feeConfig(c, c.v2, c.v2Art.abi), feeConfig(c, c.intents, c.intentsArt.abi)]);
      const diff = (["fee", "max", "recipient", "admin", "pending"] as const).filter((k) => String(a[k]).toLowerCase() !== String(b[k]).toLowerCase());
      if (diff.length) strict(`OnDealV2 and OnDealIntents differ in: ${diff.map((k) => `${k} (${a[k]} vs ${b[k]})`).join(", ")}`);
    },
  },
  {
    id: "DEP-07",
    title: "The matcher's /info agrees with the chain, and its gas wallet is funded",
    skip: (c) => (c.poolUrl ? null : "no pool URL (NEXT_PUBLIC_POOL_URL or E2E_POOL_URL)"),
    async run(c, note) {
      const r = await fetch(`${c.poolUrl}/info`, { signal: AbortSignal.timeout(10_000) });
      assert.equal(r.status, 200, `GET /info: ${r.status}`);
      const info = (await r.json()) as { chainId: number; swap: Address; matcher: Address; fee: { token: Address; amount: string; recipient: Address }; maxCycle: number };
      assert.equal(Number(info.chainId), c.chainId, "the matcher is on another chain");
      assert.ok(isAddressEqual(info.swap, c.intents), `the matcher settles through ${info.swap}, not ${c.intents}`);
      const [token, fee, recipient] = await Promise.all([
        read<Address>(c, c.intents, c.intentsArt.abi, "FEE_TOKEN"),
        read<bigint>(c, c.intents, c.intentsArt.abi, "fee"),
        read<Address>(c, c.intents, c.intentsArt.abi, "FEE_RECIPIENT"),
      ]);
      assert.ok(isAddressEqual(info.fee.token, token), "matcher fee token differs");
      assert.equal(BigInt(info.fee.amount), fee, "matcher fee amount differs from fee()");
      assert.ok(isAddressEqual(info.fee.recipient, recipient), "matcher fee recipient differs");
      assert.equal(Number(info.maxCycle), 4);
      const gas = await c.pub.getBalance({ address: info.matcher });
      note(`matcher ${info.matcher} holds ${formatEther(gas)} MON for gas`);
      const min = BigInt(Math.round(Number(str("E2E_MATCHER_MIN_MON", "1")) * 1e6)) * 10n ** 12n;
      if (gas < min) strict(`the matcher's gas wallet holds ${formatEther(gas)} MON (< ${formatEther(min)})`);
    },
  },
  {
    id: "DEP-08",
    title: "Protocol constants",
    async run(c, note) {
      const [v2Assets, inAssets, cycle, note_, spec] = await Promise.all([
        read<bigint>(c, c.v2, c.v2Art.abi, "MAX_ASSETS_PER_SIDE"),
        read<bigint>(c, c.intents, c.intentsArt.abi, "MAX_ASSETS_PER_SIDE"),
        read<bigint>(c, c.intents, c.intentsArt.abi, "MAX_CYCLE"),
        read<bigint>(c, c.v2, c.v2Art.abi, "MAX_NOTE_BYTES"),
        read<bigint>(c, c.v2, c.v2Art.abi, "MAX_SPEC_BYTES"),
      ]);
      note(`assets per side ${v2Assets}/${inAssets}, max cycle ${cycle}, note ${note_} bytes, spec ${spec} bytes`);
      assert.equal(v2Assets, 10n);
      assert.equal(inAssets, 10n);
      assert.equal(cycle, 4n);
    },
  },
  {
    id: "DEP-09",
    title: "App environment: no demo data, a real Chog collection, the watcher's start block",
    async run(c, note) {
      const problems: string[] = [];
      for (const k of ["NEXT_PUBLIC_DEMO_DEALS", "NEXT_PUBLIC_DEMO_CREATE", "NEXT_PUBLIC_DEMO_CLUBS"]) {
        // The demo flags only act in development builds, but a production env should say false.
        if (str(k).toLowerCase() === "true") problems.push(`${k}=true`);
      }
      const chog = addr("NEXT_PUBLIC_CHOG_ADDRESS");
      if (!chog) problems.push("NEXT_PUBLIC_CHOG_ADDRESS is blank, so the app falls back to the testnet MockChog");
      else if (!(await isContract(c, chog))) problems.push(`NEXT_PUBLIC_CHOG_ADDRESS ${chog} has no code on this chain`);
      const start = str("FILL_WATCHER_START_BLOCK");
      if (!start) problems.push("FILL_WATCHER_START_BLOCK is blank: the fill watcher starts at the head and misses earlier fills");
      note(`Chog ${chog ?? "default"}, watcher start ${start || "head"}`);
      if (problems.length) strict(problems.join("\n"));
    },
  },
];

async function main() {
  const rpcUrl = str("VERIFY_RPC_URL", str("NEXT_PUBLIC_RPC_URL", "https://testnet-rpc.monad.xyz"));
  const pub = createPublicClient({ transport: http(rpcUrl) }) as PublicClient;
  const ctx: Ctx = {
    pub,
    chainId: await pub.getChainId(),
    v2: needAddr("VERIFY_V2_ADDRESS", "NEXT_PUBLIC_ON_DEAL_V2_ADDRESS"),
    intents: needAddr("VERIFY_INTENTS_ADDRESS", "NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS"),
    poolUrl: str("E2E_POOL_URL", str("NEXT_PUBLIC_POOL_URL")) || undefined,
    v2Art: V2(),
    intentsArt: INTENTS(),
  };
  console.log(`verifying chain ${ctx.chainId} via ${rpcUrl}${mainnet ? " (mainnet rules)" : ""}\n  OnDealV2 ${ctx.v2}\n  OnDealIntents ${ctx.intents}\n`);
  const results = await runCases(cases, ctx, arg("only"));
  process.exitCode = finish("verify", results, { chainId: String(ctx.chainId), rpc: rpcUrl, v2: ctx.v2, intents: ctx.intents, mode: mainnet ? "mainnet" : "default" });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
