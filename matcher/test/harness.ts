import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import {
  type Abi,
  type Address,
  type Hex,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  toHex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { type Reader, makeChain, makeReader, makeSender } from "../src/chain.ts";
import { domain, types } from "../src/intent.ts";
import { Matcher, type MatcherConfig, defaultMatcherConfig } from "../src/matcher.ts";
import { Pool } from "../src/pool.ts";
import { Store } from "../src/store.ts";
import { AssetType, type Asset, type Intent } from "../src/types.ts";
import { intentToWire } from "../src/wire.ts";

const OUT = resolve(import.meta.dirname, "../../contracts/out");
export const CHAIN_ID = 31337;
/** The protocol fee the test contract charges each maker, in WMON (ADR 0015). */
export const FEE = 2n * 10n ** 18n;
/** Anvil's default, publicly known test mnemonic. */
const MNEMONIC = "test test test test test test test test test test test junk";

const artifact = (file: string, name: string) => {
  const path = `${OUT}/${file}/${name}.json`;
  const j = JSON.parse(readFileSync(path, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: j.abi, bytecode: j.bytecode.object };
};

/** Why the end-to-end tests can't run here, or null when they can. */
export function skipReason(): string | null {
  if (!existsSync(`${OUT}/OnDealIntents.sol/OnDealIntents.json`)) {
    return "contracts/out is missing: run `forge build` in contracts/";
  }
  return hasAnvil() ? null : "anvil is not installed";
}

function hasAnvil(): boolean {
  return (process.env.PATH ?? "").split(":").some((dir) => existsSync(`${dir}/anvil`));
}

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
    s.on("error", fail);
  });
}

const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const chogAbi = parseAbi([
  "function mint(address to, uint256 quantity) returns (uint256 firstId)",
  "function approve(address to, uint256 id)",
  "function setApprovalForAll(address operator, bool approved)",
  "function ownerOf(uint256 id) view returns (address)",
]);
export const walletAbi = parseAbi([
  "function exec(address target, bytes data)",
  "function setReject(bool value)",
]);
const swapAbi = parseAbi(["function invalidateNonces(uint256 word, uint256 mask)"]);

export type Actor = ReturnType<typeof makeActor>;

function makeActor(index: number, rpcUrl: string) {
  const account = mnemonicToAccount(MNEMONIC, { addressIndex: index });
  const wallet = createWalletClient({
    account,
    chain: makeChain({ chainId: CHAIN_ID, rpcUrl }),
    transport: http(rpcUrl),
  });
  return { account, wallet, address: account.address };
}

export interface World {
  rpcUrl: string;
  reader: Reader;
  swap: Address;
  chog: Address;
  usd: Address;
  weth: Address;
  /** The fee token. Every actor holds plenty of it and has approved the swap. */
  wmon: Address;
  /** Who receives the fees. */
  feeRecipient: Address;
  alice: Actor;
  bob: Actor;
  carol: Actor;
  dave: Actor;
  /** The matcher's own funded account. */
  matcherSender: ReturnType<typeof makeSender>;
  stop(): void;
  // helpers
  tx(p: Promise<Hex>): Promise<void>;
  mintChogs(to: Address, n: number): Promise<bigint[]>;
  mintToken(token: Address, to: Address, amount: bigint): Promise<void>;
  approveChog(who: Actor, id: bigint): Promise<void>;
  revokeChog(who: Actor, id: bigint): Promise<void>;
  approveToken(who: Actor, token: Address, amount: bigint): Promise<void>;
  transferToken(who: Actor, token: Address, to: Address, amount: bigint): Promise<void>;
  balanceOf(token: Address, who: Address): Promise<bigint>;
  ownerOf(id: bigint): Promise<Address>;
  deployWallet(owner: Address): Promise<Address>;
  intent(maker: Address, give: Asset[], want: Asset[], extra?: Partial<Intent>): Intent;
  sign(who: Actor, intent: Intent): Promise<Hex>;
  body(who: Actor, intent: Intent): Promise<{ intent: unknown; signature: Hex }>;
  invalidate(who: Actor, nonce: bigint): Promise<void>;
  increaseTime(sec: number): Promise<void>;
  fresh(over?: Partial<MatcherConfig>): { store: Store; pool: Pool; matcher: Matcher };
  chogOf(id: bigint): Asset;
  tokenOf(token: Address, amount: bigint): Asset;
}

export async function startWorld(): Promise<World> {
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil: ChildProcess = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  const reader = makeReader({ chainId: CHAIN_ID, rpcUrl, pollingIntervalMs: 50 });
  for (let i = 0; ; i++) {
    try {
      await reader.getChainId();
      break;
    } catch {
      if (i > 100) throw new Error("anvil did not start");
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const [deployer, alice, bob, carol, dave] = [0, 1, 2, 3, 4].map((i) => makeActor(i, rpcUrl)) as [
    Actor, Actor, Actor, Actor, Actor,
  ];
  // The matcher's own funded account: anvil's index 9, so it never holds the traders' assets.
  const matcherKey = toHex(
    mnemonicToAccount(MNEMONIC, { addressIndex: 9 }).getHdKey().privateKey!,
  );
  const matcherSender = makeSender({ chainId: CHAIN_ID, rpcUrl }, matcherKey);

  const tx = async (p: Promise<Hex>) => {
    await reader.waitForTransactionReceipt({ hash: await p });
  };
  const deploy = async (file: string, name: string, args: unknown[] = []): Promise<Address> => {
    const { abi, bytecode } = artifact(file, name);
    const hash = await deployer.wallet.deployContract({ abi, bytecode, args });
    return getAddress((await reader.waitForTransactionReceipt({ hash })).contractAddress!);
  };

  const wmon = await deploy("MockERC20.sol", "MockERC20", ["Wrapped MON", "WMON"]);
  const feeRecipient = makeActor(8, rpcUrl).address;
  const swap = await deploy("OnDealIntents.sol", "OnDealIntents", [wmon, FEE, feeRecipient]);
  const chog = await deploy("MockChog.sol", "MockChog");
  const usd = await deploy("MockERC20.sol", "MockERC20", ["Mock USD", "mUSD"]);
  const weth = await deploy("MockERC20.sol", "MockERC20", ["Mock WETH", "mWETH"]);

  let nonce = 1n;

  const world: World = {
    rpcUrl, reader, swap, chog, usd, weth, wmon, feeRecipient, alice, bob, carol, dave, matcherSender,
    stop: () => anvil.kill(),
    tx,
    async mintChogs(to, n) {
      const { result } = await reader.simulateContract({
        address: chog, abi: chogAbi, functionName: "mint", args: [to, BigInt(n)], account: deployer.account,
      });
      await tx(deployer.wallet.writeContract({ address: chog, abi: chogAbi, functionName: "mint", args: [to, BigInt(n)] }));
      return Array.from({ length: n }, (_, i) => result + BigInt(i));
    },
    async mintToken(token, to, amount) {
      await tx(deployer.wallet.writeContract({ address: token, abi: erc20Abi, functionName: "mint", args: [to, amount] }));
    },
    async approveChog(who, id) {
      await tx(who.wallet.writeContract({ address: chog, abi: chogAbi, functionName: "approve", args: [swap, id] }));
    },
    async revokeChog(who, id) {
      await tx(who.wallet.writeContract({ address: chog, abi: chogAbi, functionName: "approve", args: ["0x0000000000000000000000000000000000000000", id] }));
    },
    async approveToken(who, token, amount) {
      await tx(who.wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [swap, amount] }));
    },
    async transferToken(who, token, to, amount) {
      await tx(who.wallet.writeContract({ address: token, abi: erc20Abi, functionName: "transfer", args: [to, amount] }));
    },
    balanceOf: (token, who) =>
      reader.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] }),
    ownerOf: (id) => reader.readContract({ address: chog, abi: chogAbi, functionName: "ownerOf", args: [id] }),
    async deployWallet(owner) {
      return deploy("OnDealIntents.signatures.t.sol", "Mock1271Wallet", [owner]);
    },
    intent(maker, give, want, extra = {}) {
      return {
        maker, give, want,
        feeToken: wmon,
        fee: FEE,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
        nonce: nonce++,
        ...extra,
      };
    },
    sign: (who, intent) =>
      who.account.signTypedData({
        domain: domain(CHAIN_ID, swap), types, primaryType: "Intent", message: intent,
      }),
    async body(who, intent) {
      return { intent: intentToWire(intent), signature: await world.sign(who, intent) };
    },
    async invalidate(who, n) {
      await tx(who.wallet.writeContract({
        address: swap, abi: swapAbi, functionName: "invalidateNonces", args: [n >> 8n, 1n << (n & 0xffn)],
      }));
    },
    async increaseTime(sec) {
      await fetch(rpcUrl, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_increaseTime", params: [sec] }),
      });
      await fetch(rpcUrl, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "evm_mine", params: [] }),
      });
    },
    fresh(over = {}) {
      const store = new Store();
      const matcherRef: { current?: Matcher } = {};
      const pool = new Pool(
        store, reader,
        { chainId: CHAIN_ID, swap, fee: { token: wmon, amount: FEE }, minTtlSec: 60, maxTtlSec: 7 * 24 * 3600 },
        { onNew: () => matcherRef.current?.kick() },
      );
      const matcher = new Matcher(pool, matcherSender, { ...defaultMatcherConfig(swap), ...over });
      matcherRef.current = matcher;
      return { store, pool, matcher };
    },
    chogOf: (id) => ({ assetType: AssetType.ERC721, token: chog, id, amount: 1n }),
    tokenOf: (token, amount) => ({ assetType: AssetType.ERC20, token, id: 0n, amount }),
  };
  // Every trader can pay the fee, so a test only has to think about it when it is about the fee.
  for (const who of [alice, bob, carol, dave]) {
    await world.mintToken(wmon, who.address, 1000n * 10n ** 18n);
    await world.approveToken(who, wmon, 2n ** 256n - 1n);
  }
  return world;
}
