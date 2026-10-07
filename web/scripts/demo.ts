/**
 * Builds the testnet demo world (scripts/demo/content.ts) on mirrors of Chog Genesis, skrumpeys and
 * r3tards: real holdings and real DeClubEscrow swaps on chain, and Club roles, profiles, members,
 * signed posts, follows and avatars in the app's store. Testnet only.
 *
 *   cd web
 *   node --import ./test/register.mjs scripts/demo.ts wallets   # make the demo keys (web/.demo/, git-ignored)
 *   node --import ./test/register.mjs scripts/demo.ts chain     # mint the holdings, fund the personas, hand over the mirrors
 *   node --import ./test/register.mjs scripts/demo.ts trades    # the swaps, recorded to each Club's activity
 *   node --import ./test/register.mjs scripts/demo.ts social    # profiles, members, roles, posts, follows, avatars
 *   node --import ./test/register.mjs scripts/demo.ts art       # each Club's tile art, into public/art/clubs/ (convert
 *                                                               # to a ~480px PNG after: Chog's is WebP)
 *   node --import ./test/register.mjs scripts/demo.ts status    # addresses and balances
 *
 * Every step can be run again: it skips what is already done. Order: wallets, then deploy the
 * mirrors (DeployMirrors.s.sol), DeClubEscrow and DeClubRewards with the bank key (see
 * docs/12-demo.md), then chain, trades, social.
 *
 * Reads the root .env and web/.env* like the app. Needs the Upstash credentials, DEMO_CHOG_ADDRESS,
 * DEMO_SKRUMPEYS_ADDRESS, DEMO_R3TARDS_ADDRESS (with the same three in web/data/assets.json),
 * NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS and DEMO_PRESENTER_WALLET. PRIVY_APP_SECRET lets it find the
 * presenter's Privy user, to make them a member and the Chog Club's Owner.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "./env";
import type { Address, Hex } from "viem";
import { CLUBS, EXTRA_MEMBERS, FOLLOWS, HOLDINGS, PERSONAS, POSTS, TRADES, type ClubKey, type HolderKey, type PersonaKey, type Side } from "./demo/content";

const web = path.resolve(import.meta.dirname, "..");
loadEnv(web);

const DIR = path.resolve(web, ".demo");
const WALLETS = path.join(DIR, "wallets.json");
const STATE = path.join(DIR, "state.json");

type Wallets = { bank: Hex; personas: Record<PersonaKey, Hex> };
/** What the trades step did, so a rerun skips it. Keyed by the trade's index in TRADES. */
type State = { trades: Record<string, { tradeId: string; created: Hex; filled?: Hex }> };

const personaKeys = Object.keys(PERSONAS) as PersonaKey[];
const clubKeys = Object.keys(CLUBS) as ClubKey[];
const demoUserId = (key: PersonaKey) => `did:privy:demo-${key}`;
const HOUR = 3_600_000;

const MIRROR_ABI = [
  "function nextTokenId() view returns (uint256)",
  "function mintBatch(address to, uint256 quantity) returns (uint256)",
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
] as const;

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function main() {
  const step = process.argv[2];
  const { createPublicClient, createWalletClient, decodeEventLog, formatEther, getAddress, http, parseAbi, parseEther, zeroAddress } = await import("viem");
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");

  if (step === "wallets") {
    await mkdir(DIR, { recursive: true });
    let wallets = await readJson<Wallets>(WALLETS);
    if (!wallets) {
      wallets = { bank: generatePrivateKey(), personas: Object.fromEntries(personaKeys.map((k) => [k, generatePrivateKey()])) as Record<PersonaKey, Hex> };
      await writeFile(WALLETS, JSON.stringify(wallets, null, 2) + "\n", { mode: 0o600 });
      console.log(`wrote ${path.relative(process.cwd(), WALLETS)}`);
    }
    console.log(`bank    ${privateKeyToAccount(wallets.bank).address}   ← fund this one; it deploys, mints and pays the personas' gas`);
    for (const k of personaKeys) console.log(`${k.padEnd(9)} ${privateKeyToAccount(wallets.personas[k]).address}  ${PERSONAS[k].handle}`);
    return;
  }

  const wallets = await readJson<Wallets>(WALLETS);
  if (!wallets) throw new Error("No demo wallets yet: run the `wallets` step first.");
  const bank = privateKeyToAccount(wallets.bank);
  const persona = (k: PersonaKey) => privateKeyToAccount(wallets.personas[k]);
  const presenterEnv = process.env.DEMO_PRESENTER_WALLET?.trim();
  const presenter = presenterEnv ? getAddress(presenterEnv) : null;
  const walletOf = (k: HolderKey): Address => {
    if (k !== "you") return persona(k).address;
    if (!presenter) throw new Error("Set DEMO_PRESENTER_WALLET.");
    return presenter;
  };
  const clubAddress = (c: ClubKey): Address => {
    const value = process.env[CLUBS[c].env]?.trim();
    if (!value) throw new Error(`Set ${CLUBS[c].env} (from DeployMirrors.s.sol).`);
    return getAddress(value);
  };
  /** The token id of `holder`'s n-th token (from 0) of `club`, as minted. */
  const idOf = (club: ClubKey, holder: HolderKey, n: number): bigint => {
    let next = 1;
    for (const [who, count] of HOLDINGS[club]) {
      if (who === holder) {
        if (n >= count) throw new Error(`${holder} holds only ${count} of ${club}`);
        return BigInt(next + n);
      }
      next += count;
    }
    throw new Error(`${holder} holds no ${club}`);
  };

  const { chain } = await import("../lib/chain");
  const { CHAIN_ID, DECLUB_ESCROW_ADDRESS, RPC_URL } = await import("../lib/config");
  if (CHAIN_ID !== 10143) throw new Error("The demo is for Monad testnet (NEXT_PUBLIC_CHAIN_ID=10143) only.");
  const { deClubEscrowAbi } = await import("../lib/abi");
  const pub = createPublicClient({ chain, transport: http(RPC_URL) });
  const mirrorAbi = parseAbi(MIRROR_ABI);
  const clientOf = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(RPC_URL) });

  /**
   * Monad reverts (and still bills) a wallet's transaction when the wallet holds under 10 MON and sent another one in the last
   * few blocks (its reserve balance rule), so a wallet's transactions are spaced out: the approval, then the trade.
   */
  const lastSent = new Map<string, number>();
  const SPACING_MS = 3_000;
  const spaced = async (address: Address) => {
    const wait = (lastSent.get(address) ?? 0) + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  };

  /** Sends one transaction and waits for it, failing loudly on a revert. */
  const send = async (key: Hex, request: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint }) => {
    // The estimate can come in a hair under what a fill really uses, and Monad bills the limit: triple the estimate, since Monad prices cold storage reads above the estimate.
    // But a wallet must afford the whole limit at the max fee (or the transaction fails and still pays), so the max fee is set here
    // (1.3x the base fee, plus the tip) and the limit is capped at what the wallet can cover at that fee.
    const from = privateKeyToAccount(key).address;
    await spaced(from);
    const estimate = await pub.estimateContractGas({ ...request, account: from } as never);
    const wanted = (estimate * BigInt(process.env.DEMO_GAS_PCT || 300)) / 100n;
    const tip = 2_000_000_000n;
    const maxFeePerGas = ((await pub.getBlock()).baseFeePerGas ?? 100_000_000_000n) * 13n / 10n + tip;
    const balance = await pub.getBalance({ address: from });
    const affordable = (((balance - (request.value ?? 0n)) / maxFeePerGas) * 95n) / 100n;
    if (affordable < estimate) throw new Error(`${from} can't afford ${request.functionName}: ${formatEther(balance)} MON`);
    const gas = wanted < affordable ? wanted : affordable;
    const hash = await clientOf(key).writeContract({ ...request, gas, maxFeePerGas, maxPriorityFeePerGas: tip } as never);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    lastSent.set(from, Date.now());
    if (receipt.status !== "success") throw new Error(`${request.functionName} reverted: ${hash}`);
    return receipt;
  };
  const transfer = async (key: Hex, to: Address, value: bigint) => {
    const hash = await clientOf(key).sendTransaction({ to, value });
    await pub.waitForTransactionReceipt({ hash });
  };

  if (step === "status") {
    console.log(`bank      ${bank.address}  ${formatEther(await pub.getBalance({ address: bank.address }))} MON`);
    for (const k of personaKeys) {
      const a = persona(k).address;
      console.log(`${k.padEnd(9)} ${a}  ${formatEther(await pub.getBalance({ address: a }))} MON`);
    }
    for (const c of clubKeys) {
      const value = process.env[CLUBS[c].env]?.trim();
      if (!value) {
        console.log(`${c}: ${CLUBS[c].env} not set`);
        continue;
      }
      const next = await pub.readContract({ address: getAddress(value), abi: mirrorAbi, functionName: "nextTokenId" });
      const owner = await pub.readContract({ address: getAddress(value), abi: mirrorAbi, functionName: "owner" });
      console.log(`${c}: ${value}  minted ${next - 1n}  owner ${owner}`);
    }
    return;
  }

  if (step === "chain") {
    // 1. The holdings, minted in HOLDINGS order so `idOf` names the right tokens.
    for (const c of clubKeys) {
      const token = clubAddress(c);
      const planned = HOLDINGS[c].reduce((sum, [, n]) => sum + n, 0);
      const next = await pub.readContract({ address: token, abi: mirrorAbi, functionName: "nextTokenId" });
      if (next === BigInt(planned + 1)) {
        console.log(`${c}: ${planned} already minted`);
        continue;
      }
      if (next !== 1n) throw new Error(`${c} has ${next - 1n} minted, not 0 or ${planned}: deploy a fresh mirror.`);
      for (const [who, count] of HOLDINGS[c]) {
        await send(wallets.bank, { address: token, abi: mirrorAbi, functionName: "mintBatch", args: [walletOf(who), BigInt(count)] });
        console.log(`${c}: minted ${count} to ${who}`);
      }
    }

    // 2. Gas, fees and prices for each persona's swaps, topped up to what they need.
    if (!DECLUB_ESCROW_ADDRESS) throw new Error("Set NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS.");
    const fee = await pub.readContract({ address: DECLUB_ESCROW_ADDRESS, abi: deClubEscrowAbi, functionName: "fee" });
    // Monad charges the gas limit, at about 100 gwei on testnet: an approval stays under 0.01 MON, a create or fill under 0.15 with the headroom.
    const approval = parseEther("0.01");
    const call = parseEther("0.15");
    const need = new Map<PersonaKey, bigint>();
    const add = (k: PersonaKey, v: bigint) => need.set(k, (need.get(k) ?? 0n) + v);
    for (const t of TRADES) {
      add(t.maker, approval + call + fee);
      if (t.taker) add(t.taker, ("nft" in t.wants ? approval : 0n) + call + fee + ("mon" in t.wants ? parseEther(t.wants.mon) : 0n));
    }
    for (const [k, amount] of need) {
      const address = persona(k).address;
      const balance = await pub.getBalance({ address });
      if (balance >= amount) continue;
      await transfer(wallets.bank, address, amount - balance);
      console.log(`funded ${k} with ${formatEther(amount - balance)} MON`);
    }

    // 3. Each mirror to its Club's Owner, so `owner()` agrees with the Club's claimed Owner.
    for (const c of clubKeys) {
      const token = clubAddress(c);
      const owner = walletOf(CLUBS[c].owner);
      const current = await pub.readContract({ address: token, abi: mirrorAbi, functionName: "owner" });
      if (current.toLowerCase() === owner.toLowerCase()) continue;
      if (current.toLowerCase() !== bank.address.toLowerCase()) throw new Error(`${c}'s owner is ${current}, not the bank`);
      await send(wallets.bank, { address: token, abi: mirrorAbi, functionName: "transferOwnership", args: [owner] });
      console.log(`${c}: owner() is now ${CLUBS[c].owner} (${owner})`);
    }
    console.log(`bank left with ${formatEther(await pub.getBalance({ address: bank.address }))} MON`);
    return;
  }

  if (step === "art") {
    const { readJson: readMetadata } = await import("../lib/server/collectionScan");
    const { IPFS_GATEWAY } = await import("../lib/config");
    for (const c of clubKeys) {
      const file = path.join(web, "public", CLUBS[c].image);
      if (await readFile(file).then(() => true, () => false)) continue;
      const meta = (await readMetadata(CLUBS[c].art)) as { image?: string } | null;
      if (!meta?.image) throw new Error(`${c}: no image in ${CLUBS[c].art}`);
      const url = meta.image.startsWith("ipfs://") ? IPFS_GATEWAY + meta.image.slice("ipfs://".length) : meta.image;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${c}: ${response.status} from ${url}`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
      console.log(`${c}: ${CLUBS[c].image}`);
    }
    return;
  }

  // The steps below write to the app's store.
  if (!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)) {
    throw new Error("No store: set the Upstash credentials the app uses (UPSTASH_REDIS_REST_URL / _TOKEN).");
  }
  const { getStore } = await import("../lib/server/store");
  const { registry } = await import("../lib/verifiedAssets");
  const store = getStore()!;
  const entryOf = (c: ClubKey) => {
    const entry = registry.clubFor(clubAddress(c));
    if (!entry) throw new Error(`${clubAddress(c)} (${c}) has no Club: add it to web/data/assets.json.`);
    return entry;
  };

  if (step === "trades") {
    if (!DECLUB_ESCROW_ADDRESS) throw new Error("Set NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS.");
    const escrow = DECLUB_ESCROW_ADDRESS;
    const { ingestTx } = await import("../lib/server/activity");
    const state = (await readJson<State>(STATE)) ?? { trades: {} };
    const save = () => writeFile(STATE, JSON.stringify(state, null, 2) + "\n");
    const fee = await pub.readContract({ address: escrow, abi: deClubEscrowAbi, functionName: "fee" });
    for (const c of clubKeys) entryOf(c);

    const asset = (side: Side, holder: HolderKey) =>
      "mon" in side
        ? { assetType: 0, token: zeroAddress, id: 0n, amount: parseEther(side.mon) }
        : { assetType: 2, token: clubAddress(side.nft[0]), id: idOf(side.nft[0], holder, side.nft[1]), amount: 1n };
    const approve = async (k: PersonaKey, side: Side) => {
      if ("mon" in side) return;
      const token = clubAddress(side.nft[0]);
      const ok = await pub.readContract({ address: token, abi: mirrorAbi, functionName: "isApprovedForAll", args: [persona(k).address, escrow] });
      if (!ok) await send(wallets.personas[k], { address: token, abi: mirrorAbi, functionName: "setApprovalForAll", args: [escrow, true] });
    };
    const record = async (hash: Hex) => {
      const result = await ingestTx(store, hash);
      if (result.status !== "recorded") throw new Error(`no receipt yet for ${hash}`);
    };

    for (const [i, t] of TRADES.entries()) {
      const done = state.trades[i];
      if (done && (done.filled || !t.taker)) continue;
      const offered = [asset(t.gives, t.maker)];
      const requested = [asset(t.wants, t.taker ?? t.maker)];
      let tradeId: bigint;
      if (done) {
        tradeId = BigInt(done.tradeId);
      } else {
        await approve(t.maker, t.gives);
        const expiry = BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400);
        const receipt = await send(wallets.personas[t.maker], {
          address: escrow,
          abi: deClubEscrowAbi,
          functionName: "createTrade",
          args: [offered, requested, zeroAddress, expiry],
          value: fee,
        });
        const created = receipt.logs
          .filter((log) => log.address.toLowerCase() === escrow.toLowerCase())
          .map((log) => {
            try {
              return decodeEventLog({ abi: deClubEscrowAbi, data: log.data, topics: log.topics });
            } catch {
              return null;
            }
          })
          .find((e) => e?.eventName === "TradeCreated");
        tradeId = (created!.args as { tradeId: bigint }).tradeId;
        await record(receipt.transactionHash);
        state.trades[i] = { tradeId: tradeId.toString(), created: receipt.transactionHash };
        await save();
        console.log(`#${tradeId} ${t.maker} offers ${JSON.stringify(t.gives)} for ${JSON.stringify(t.wants)}${t.ref ? ` (open: ${t.ref})` : ""}`);
      }
      if (!t.taker) continue;
      await approve(t.taker, t.wants);
      const price = "mon" in t.wants ? parseEther(t.wants.mon) : 0n;
      const receipt = await send(wallets.personas[t.taker], { address: escrow, abi: deClubEscrowAbi, functionName: "fillTrade", args: [tradeId], value: price + fee });
      await record(receipt.transactionHash);
      state.trades[i]!.filled = receipt.transactionHash;
      await save();
      console.log(`#${tradeId} filled by ${t.taker}`);
    }
    return;
  }

  if (step === "social") {
    const { syncProfile } = await import("../lib/server/profileSync");
    const { joinClub } = await import("../lib/server/members");
    const { saveRoles, loadProfile, saveProfile, appendLog, readLog } = await import("../lib/server/clubState");
    const { createSignedPost } = await import("../lib/server/board");
    const { recordFollow } = await import("../lib/server/follows");
    const { setNftAvatar } = await import("../lib/server/avatars");
    const { cleanText, checkProfileEdit } = await import("../lib/clubPosts");
    const { postTypedData, followTypedData, linkString } = await import("../lib/social");
    const { linkedEthereumWallets } = await import("../lib/profiles");

    const state = (await readJson<State>(STATE)) ?? { trades: {} };
    const now = Date.now();
    const seconds = (ms: number) => Math.floor(ms / 1000);

    // The presenter's Privy user, so they can be a member and the Chog Club's Owner.
    let presenterUser: { id: string; wallets: Address[] } | null = null;
    const secret = process.env.PRIVY_APP_SECRET?.trim();
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
    if (presenter && secret && appId) {
      const { PrivyClient } = await import("@privy-io/node");
      try {
        const user = await new PrivyClient({ appId, appSecret: secret }).users().getByWalletAddress({ address: presenter });
        presenterUser = { id: user.id, wallets: linkedEthereumWallets(user.linked_accounts) };
      } catch (error) {
        console.warn(`No Privy user links ${presenter}: sign in to the app with it once, then run this step again.`, error instanceof Error ? error.message : "");
      }
    } else {
      console.warn("Without DEMO_PRESENTER_WALLET, NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET the presenter isn't added.");
    }
    const userIdOf = (k: HolderKey) => (k === "you" ? presenterUser?.id ?? null : demoUserId(k));

    // 1. Profiles: each persona shares a Discord handle (posting needs a shared profile).
    for (const k of personaKeys) {
      await syncProfile(store, demoUserId(k), [{ type: "wallet", chain_type: "ethereum", address: persona(k).address }, { type: "discord_oauth", username: PERSONAS[k].handle }] as never, false);
    }
    console.log(`profiles: ${personaKeys.length}`);

    // 2. Members: everyone in each Club they hold in, plus EXTRA_MEMBERS; joined before their first post.
    const memberships: [HolderKey, ClubKey][] = [
      ...clubKeys.flatMap((c) => HOLDINGS[c].map(([k]) => [k, c] as [HolderKey, ClubKey])),
      ...EXTRA_MEMBERS,
    ];
    for (const [k, c] of memberships) {
      const userId = userIdOf(k);
      if (!userId) continue;
      const firstPost = Math.max(0, ...POSTS.filter((p) => p.club === c && p.by === k).map((p) => p.ago));
      const joinedAt = now - (Math.max(firstPost, 24) + 12 + (k.length % 5) * 7) * HOUR;
      const walletsOf = k === "you" ? presenterUser!.wallets : [persona(k).address];
      const result = await joinClub(store, entryOf(c), userId, walletsOf, { now: () => joinedAt });
      if (!result.ok) throw new Error(`${k} couldn't join ${c}: ${result.reason}`);
    }
    console.log(`memberships: ${memberships.length}`);

    // 3. Roles and the Owner's claim, with the log lines the app would have written.
    for (const c of clubKeys) {
      const token = clubAddress(c);
      const owner = userIdOf(CLUBS[c].owner);
      const moderators = CLUBS[c].moderators.map(demoUserId);
      await saveRoles(store, token, { ...(owner ? { owner } : {}), moderators });
      if ((await readLog(store, token, 1)).length === 0 && owner) {
        const ownerWallet = walletOf(CLUBS[c].owner).toLowerCase();
        await appendLog(store, token, { actor: ownerWallet, action: "claim_owner", target: ownerWallet }, now - 320 * HOUR);
        for (const m of CLUBS[c].moderators) {
          await appendLog(store, token, { actor: ownerWallet, action: "appoint_moderator", target: persona(m).address.toLowerCase() }, now - 300 * HOUR);
        }
      }
    }

    // 4. Posts, signed by each persona's wallet at the post's own time.
    const tradeIdOf = (ref: string) => {
      const i = TRADES.findIndex((t) => t.ref === ref);
      const id = state.trades[i]?.tradeId;
      if (!id) throw new Error(`The open trade "${ref}" hasn't been made: run the trades step first.`);
      return id;
    };
    const pinned = new Map<ClubKey, string[]>();
    let posted = 0;
    for (const p of [...POSTS].sort((a, b) => b.ago - a.ago)) {
      const at = seconds(now - p.ago * HOUR);
      const text = cleanText(p.text);
      if (!text.ok) throw new Error(`Post "${p.text}" is ${text.reason}`);
      const message = {
        club: clubAddress(p.club),
        kind: p.ref ? ("looking" as const) : ("note" as const),
        text: text.text,
        link: p.ref ? linkString({ kind: "deal", id: tradeIdOf(p.ref) }) : "",
        at,
      };
      const signature = await persona(p.by).signTypedData(postTypedData(message) as never);
      const userId = demoUserId(p.by);
      const token = clubAddress(p.club).toLowerCase();
      // The Board's per-user cooldown and hourly cap are real-time limits; seeded posts are spread over days.
      await store.del(`declub:rl:club-post-cd:${token}:${userId}`, `declub:rl:club-post-hr:${token}:${userId}`);
      const result = await createSignedPost(store, entryOf(p.club), userId, { message, signature }, { now: () => at * 1000 });
      if (!result.ok) throw new Error(`${p.by}'s post in ${p.club} was refused: ${result.reason}`);
      if (p.pin) pinned.set(p.club, [...(pinned.get(p.club) ?? []), result.post.id]);
      posted++;
    }
    console.log(`posts: ${posted}`);

    // 5. Club profiles: description, the mainnet collection, X tags, pins and the Owner's claim.
    for (const c of clubKeys) {
      const token = clubAddress(c);
      const edit = checkProfileEdit({ xTags: CLUBS[c].tags });
      if (!edit.ok) throw new Error(`${c}'s tags: ${edit.reason}`);
      const current = await loadProfile(store, token);
      const owner = userIdOf(CLUBS[c].owner);
      await saveProfile(store, token, {
        ...current,
        description: CLUBS[c].description,
        links: [`https://monadscan.com/address/${CLUBS[c].mainnet}`],
        holdersOnlyPosts: false,
        pinned: pinned.get(c) ?? current.pinned,
        ...(owner ? { ownerClaim: { wallet: walletOf(CLUBS[c].owner).toLowerCase(), at: now - 320 * HOUR } } : {}),
        x: { accounts: current.x?.accounts ?? [], tags: edit.edit.xTags ?? [] },
      });
    }
    console.log("Club profiles: 3");

    // 6. Follows, signed like the app's.
    let followed = 0;
    for (const [i, [from, to]] of FOLLOWS.entries()) {
      if (to === "you" && !presenter) continue;
      const at = seconds(now - (200 - i * 7) * HOUR);
      const message = { follower: persona(from).address, target: walletOf(to), following: true, at };
      const signature = await persona(from).signTypedData(followTypedData(message) as never);
      const result = await recordFollow(store, demoUserId(from), [persona(from).address], { message, signature }, { now: () => at });
      if (!result.ok && result.reason !== "outdated") throw new Error(`${from} → ${to}: ${result.reason}`);
      followed++;
    }
    console.log(`follows: ${followed}`);

    // 7. Avatars: each persona's first token, in the order of the Clubs, that it still holds.
    let avatars = 0;
    for (const k of personaKeys) {
      const address = persona(k).address;
      for (const c of clubKeys) {
        const token = clubAddress(c);
        const held = await pub.readContract({ address: token, abi: mirrorAbi, functionName: "balanceOf", args: [address] });
        if (held === 0n) continue;
        const id = await pub.readContract({ address: token, abi: mirrorAbi, functionName: "tokenOfOwnerByIndex", args: [address, 0n] });
        const result = await setNftAvatar(store, demoUserId(k), [address], token, id).catch(() => null);
        if (result?.ok) avatars++;
        else console.warn(`${k}: no avatar from ${c} #${id} (${result ? result.reason : "metadata unreachable"})`);
        break;
      }
    }
    console.log(`avatars: ${avatars}`);
    return;
  }

  throw new Error("Steps: wallets, chain, trades, social, art, status.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
