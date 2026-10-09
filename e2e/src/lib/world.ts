import assert from "node:assert/strict";
import {
  type Abi,
  type Address,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  maxUint256,
  parseEventLogs,
  zeroAddress,
} from "viem";
import { INTENTS, MOCK_CHOG, MOCK_ERC20, MOCK_WMON, ESCROW } from "./artifacts.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Actor {
  name: string;
  account: LocalAccount;
  wallet: WalletClient;
  address: Address;
}

export interface Addresses {
  escrow: Address;
  intents: Address;
  /** An ERC-721 with an open `mint(to, quantity)` (MockChog). */
  nft: Address;
  /** An ERC-20 with an open `mint(to, amount)` (mUSD). */
  usd: Address;
}

export interface WorldConfig extends Addresses {
  target: "local" | "testnet";
  chainId: number;
  rpcUrl: string;
  actors: LocalAccount[];
  feeAdmin?: LocalAccount;
  poolUrl?: string;
  /** Local only: move the chain's clock. Testnet waits instead. */
  canWarp: boolean;
  /** DeClubRewards, when deployed; its operator is the relayer actor. */
  rewards?: Address;
  stop?: () => void;
}

/** Asset type values shared by both contracts' enums. */
export const NATIVE = 0;
export const ERC20 = 1;
export const ERC721 = 2;
export const ERC721_TRAIT = 3;

export interface Asset {
  assetType: number;
  token: Address;
  id: bigint;
  amount: bigint;
}

export interface Intent {
  maker: Address;
  give: Asset[];
  want: Asset[];
  feeToken: Address;
  maxFee: bigint;
  deadline: bigint;
  nonce: bigint;
}

// The EIP-712 types are written out in each package on purpose: the app and the matcher deploy on their own, and e2e checks both against a third copy (IN-01).
// jscpd:ignore-start
/** The EIP-712 types the app and the matcher sign with (web/lib/intents.ts, matcher/src/intent.ts). */
export const INTENT_TYPES = {
  Asset: [
    { name: "assetType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "id", type: "uint256" },
    { name: "amount", type: "uint256" },
  ],
  Intent: [
    { name: "maker", type: "address" },
    { name: "give", type: "Asset[]" },
    { name: "want", type: "Asset[]" },
    { name: "feeToken", type: "address" },
    { name: "maxFee", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;
// jscpd:ignore-end
export const DOMAIN_NAME = "DeClubIntents";
export const DOMAIN_VERSION = "1";

export type World = Awaited<ReturnType<typeof makeWorld>>;

export async function makeWorld(cfg: WorldConfig) {
  const chain = defineChain({
    id: cfg.chainId,
    name: cfg.target,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const transport = () => http(cfg.rpcUrl, { timeout: 15_000, retryCount: 2 });
  const pub = createPublicClient({ chain, transport: transport(), pollingInterval: cfg.target === "local" ? 50 : 500 }) as PublicClient;
  const actor = (name: string, account: LocalAccount): Actor => ({
    name,
    account,
    address: account.address,
    wallet: createWalletClient({ account, chain, transport: transport() }),
  });
  if (cfg.actors.length < 5) throw new Error("need 5 accounts: alice, bob, carol, dave and a relayer");
  const [alice, bob, carol, dave, relayer] = (["alice", "bob", "carol", "dave", "relayer"] as const).map((n, i) => actor(n, cfg.actors[i]!)) as [
    Actor,
    Actor,
    Actor,
    Actor,
    Actor,
  ];
  const feeAdmin = cfg.feeAdmin ? actor("feeAdmin", cfg.feeAdmin) : undefined;

  const nftAbi = MOCK_CHOG().abi;
  const erc20Abi = MOCK_ERC20().abi;
  const wmonAbi = MOCK_WMON().abi;
  // Token errors bubble up through the deal contracts; with them in the ABI a revert names its cause.
  const tokenErrors = [...erc20Abi, ...nftAbi].filter((x) => x.type === "error");
  const escrowAbi = [...ESCROW().abi, ...tokenErrors] as Abi;
  const intentsAbi = [...INTENTS().abi, ...tokenErrors] as Abi;

  const read = <T>(address: Address, abi: Abi, functionName: string, args: unknown[] = []) =>
    pub.readContract({ address, abi, functionName, args }) as Promise<T>;

  const feeToken = await read<Address>(cfg.intents, intentsAbi, "FEE_TOKEN");
  const feeRecipient = await read<Address>(cfg.escrow, escrowAbi, "FEE_RECIPIENT");
  const intentsRecipient = await read<Address>(cfg.intents, intentsAbi, "FEE_RECIPIENT");

  /** Simulate (for a decoded revert), send, and wait for a successful receipt. */
  async function send(who: Actor, address: Address, abi: Abi, functionName: string, args: unknown[] = [], value?: bigint): Promise<TransactionReceipt> {
    const { request } = await pub.simulateContract({ account: who.account, address, abi, functionName, args, value });
    const nonce = await nextTxNonce(who);
    const hash = await who.wallet.writeContract({ ...request, account: who.account, chain, nonce } as Parameters<WalletClient["writeContract"]>[0]);
    const receipt = await confirm(hash, `${who.name} ${functionName}`);
    assert.equal(receipt.status, "success", `${functionName} reverted on-chain (${hash})`);
    return receipt;
  }

  /** Each wallet's next nonce, never below one this run already used: two sends can't share it. */
  const used = new Map<Address, number>();
  async function nextTxNonce(who: Actor): Promise<number> {
    const chainNext = await pub.getTransactionCount({ address: who.address, blockTag: "pending" });
    const n = Math.max(chainNext, (used.get(who.address) ?? -1) + 1);
    used.set(who.address, n);
    return n;
  }

  /**
   * Poll for the receipt with a hard deadline, then wait until the head includes its block, so the
   * next read sees it. Plain polling: viem's block watcher was seen to miss receipts on anvil and
   * ignore its own timeout.
   */
  async function confirm(hash: Hex, what: string): Promise<TransactionReceipt> {
    const deadline = Date.now() + (cfg.target === "local" ? 30_000 : 180_000);
    const pause = cfg.target === "local" ? 50 : 500;
    for (;;) {
      const receipt = await pub.getTransactionReceipt({ hash }).catch(() => null);
      if (receipt) {
        while ((await pub.getBlockNumber({ cacheTime: 0 })) < receipt.blockNumber) await sleep(pause);
        return receipt;
      }
      if (Date.now() > deadline) break;
      await sleep(pause);
    }
    const tx = await pub.getTransaction({ hash }).catch(() => null);
    const block = await pub.getBlock({ blockTag: "latest" });
    const facts = tx
      ? `nonce ${tx.nonce}, in block ${tx.blockNumber ?? "none"}, chain nonce latest ${await pub.getTransactionCount({ address: tx.from, blockTag: "latest" })} / pending ${await pub.getTransactionCount({ address: tx.from, blockTag: "pending" })}, maxFeePerGas ${tx.maxFeePerGas}, baseFee ${block.baseFeePerGas}`
      : "the node no longer knows the transaction (dropped or replaced)";
    throw new Error(`${what}: ${hash} not mined: ${facts}`);
  }

  /** Asserts that the call reverts with the custom error `errorName` ("*" for any revert). */
  async function expectRevert(who: Actor, address: Address, abi: Abi, functionName: string, args: unknown[], errorName: string, value?: bigint): Promise<void> {
    try {
      await pub.simulateContract({ account: who.account, address, abi, functionName, args, value });
    } catch (e) {
      if (errorName === "*") return;
      const reverted = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
      const got = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
      assert.equal(got, errorName, `${functionName}: expected ${errorName}, got ${got ?? (e as Error).message.split("\n")[0]}`);
      return;
    }
    assert.fail(`${functionName}: expected ${errorName}, but the call would succeed`);
  }

  function events<T = Record<string, unknown>>(receipt: TransactionReceipt, abi: Abi, eventName: string, address?: Address): T[] {
    return parseEventLogs({ abi, logs: receipt.logs, eventName })
      .filter((l) => !address || l.address.toLowerCase() === address.toLowerCase())
      .map((l) => (l as unknown as { args: T }).args);
  }

  const now = async () => (await pub.getBlock({ blockTag: "latest" })).timestamp;

  /** Let `sec` seconds pass on the chain: anvil jumps, a live chain is waited out. */
  async function warp(sec: number) {
    if (cfg.canWarp) {
      await pub.request({ method: "evm_increaseTime" as never, params: [sec] as never });
      await pub.request({ method: "evm_mine" as never, params: [] as never });
      return;
    }
    const target = (await now()) + BigInt(sec);
    while ((await now()) < target) await sleep(1000);
  }

  // ── Balances and setup ────────────────────────────────────────────────

  const monOf = (who: Address) => pub.getBalance({ address: who });
  const balanceOf = (token: Address, who: Address) => read<bigint>(token, erc20Abi, "balanceOf", [who]);
  const ownerOf = (id: bigint, nft = cfg.nft) => read<Address>(nft, nftAbi, "ownerOf", [id]);

  /** Mint `n` NFTs to `who` and return their ids (from the receipt, so concurrent mints don't matter). */
  async function mintNfts(who: Actor, n: number): Promise<bigint[]> {
    const receipt = await send(who, cfg.nft, nftAbi, "mint", [who.address, BigInt(n)]);
    return events<{ from: Address; to: Address; tokenId: bigint }>(receipt, nftAbi, "Transfer", cfg.nft)
      .filter((t) => t.from === zeroAddress && t.to === who.address)
      .map((t) => t.tokenId);
  }

  async function mintUsd(who: Actor, amount: bigint) {
    await send(who, cfg.usd, erc20Abi, "mint", [who.address, amount]);
  }

  const approved = new Set<string>();
  async function approveAll(who: Actor, spender: Address, nft = cfg.nft) {
    const k = `nft:${who.address}:${spender}:${nft}`;
    if (approved.has(k)) return;
    if (!(await read<boolean>(nft, nftAbi, "isApprovedForAll", [who.address, spender]))) {
      await send(who, nft, nftAbi, "setApprovalForAll", [spender, true]);
    }
    approved.add(k);
  }
  async function approveToken(who: Actor, token: Address, spender: Address) {
    const k = `erc20:${who.address}:${spender}:${token}`;
    if (approved.has(k)) return;
    if ((await read<bigint>(token, erc20Abi, "allowance", [who.address, spender])) < maxUint256 / 2n) {
      await send(who, token, erc20Abi, "approve", [spender, maxUint256]);
    }
    approved.add(k);
  }

  /** Make sure `who` holds at least `amount` of the fee token (wrapping MON) and has approved the intents contract. */
  async function ensureFeeToken(who: Actor, amount: bigint) {
    const have = await balanceOf(feeToken, who.address);
    if (have < amount) await send(who, feeToken, wmonAbi, "deposit", [], amount - have);
    await approveToken(who, feeToken, cfg.intents);
  }

  /** Testnet: top `who` up to `min` MON from alice. */
  async function ensureMon(who: Actor, min: bigint) {
    const have = await monOf(who.address);
    if (have >= min || who === alice) return;
    const hash = await alice.wallet.sendTransaction({ account: alice.account, chain, to: who.address, value: min - have });
    await confirm(hash, `fund ${who.name}`);
  }

  // ── Intents ───────────────────────────────────────────────────────────

  let nonceSeq = 0n;
  /** Unordered nonces: time-based, so runs against the same contract never collide. */
  const nextNonce = () => (BigInt(Date.now()) << 20n) | nonceSeq++;

  const domain = { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId: cfg.chainId, verifyingContract: cfg.intents } as const;

  async function intent(maker: Address, give: Asset[], want: Asset[], extra: Partial<Intent> = {}): Promise<Intent> {
    return {
      maker,
      give,
      want,
      feeToken,
      maxFee: await read<bigint>(cfg.intents, intentsAbi, "fee"),
      deadline: (await now()) + 3600n,
      nonce: nextNonce(),
      ...extra,
    };
  }
  /** `signer` signs for `intent.maker` (itself, or a 1271 wallet it owns). */
  const sign = (signer: Actor, i: Intent): Promise<Hex> => signer.account.signTypedData({ domain, types: INTENT_TYPES, primaryType: "Intent", message: i });

  const nftAsset = (id: bigint, nft = cfg.nft): Asset => ({ assetType: ERC721, token: nft, id, amount: 1n });
  const tokenAsset = (token: Address, amount: bigint): Asset => ({ assetType: ERC20, token, id: 0n, amount });
  const monAsset = (amount: bigint): Asset => ({ assetType: NATIVE, token: zeroAddress, id: 0n, amount });

  const fmt = (wei: bigint) => `${formatEther(wei)}`;

  return {
    ...cfg,
    chain,
    pub,
    alice,
    bob,
    carol,
    dave,
    relayer,
    feeAdmin,
    traders: [alice, bob, carol, dave],
    abi: { escrow: escrowAbi, intents: intentsAbi, nft: nftAbi, erc20: erc20Abi, wmon: wmonAbi },
    feeToken,
    feeRecipient,
    intentsRecipient,
    read,
    send,
    confirm,
    expectRevert,
    events,
    now,
    warp,
    monOf,
    balanceOf,
    ownerOf,
    mintNfts,
    mintUsd,
    approveAll,
    approveToken,
    ensureFeeToken,
    ensureMon,
    intent,
    sign,
    domain,
    nextNonce,
    nftAsset,
    tokenAsset,
    monAsset,
    fmt,
    escrowFee: () => read<bigint>(cfg.escrow, escrowAbi, "fee"),
    intentsFee: () => read<bigint>(cfg.intents, intentsAbi, "fee"),
    trade: (id: bigint) => read<{ maker: Address; status: number; fee: bigint; taker: Address; expiry: bigint }>(cfg.escrow, escrowAbi, "getTrade", [id]),
    stop: () => cfg.stop?.(),
  };
}

/** DeClubEscrow `Status` values. */
export const Status = { None: 0, Open: 1, Filled: 2, Cancelled: 3 } as const;
/** DeClubEscrow `ProposalStatus` values. */
export const ProposalStatus = { None: 0, Active: 1, Accepted: 2, Withdrawn: 3, Rejected: 4 } as const;
