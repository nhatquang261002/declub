import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { deClubRewardsAbi } from "../abi";
import { DECLUB_REWARDS_ADDRESS } from "../config";
import { SPONSOR_MIN_WEI, epochAt, epochWindow, sponsorMessage } from "../rewards";
import type { ClubEntry, Registry } from "../verifiedAssets";
import { loadRoles } from "./clubState";
import { getMember } from "./members";
import { chainClient, lastKey, recordSponsor } from "./rewards";
import { cleanSponsorName } from "./sponsors";
import { clientId, getStore, withinLimit, type Store } from "./store";

/**
 * Sponsoring a Club's epoch from the app (ADR 0036). The sponsor sends MON to the rewards
 * operator, the server reads that payment off the chain, and a signature from the sender binds it
 * to a name. Nothing the browser says is believed: the amount, the sender and the time come from the
 * transaction, and only the name and the Club come from the request.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const fail = (status: number, error: string, message: string) => Response.json({ error, message }, { status, headers: NO_STORE });

/** A payment as the chain shows it. */
export type Payment = { from: Address; to: Address | null; value: bigint; ok: boolean; /** Unix seconds of its block. */ at: number };

export type SponsorDeps = {
  store?: () => Store | null;
  now?: () => number;
  /** The rewards operator, who receives the money. Defaults to `operator()` on the rewards contract. */
  operator?: () => Promise<Address | null>;
  /** The payment behind a transaction hash, or null when it isn't on the chain. */
  payment?: (hash: Hex) => Promise<Payment | null>;
  /** Whether `signature` is `address`'s signature of `message` (a smart wallet's included). */
  verify?: (input: { address: Address; message: string; signature: Hex }) => Promise<boolean>;
  genesis?: number;
  length?: number;
};

const storeOf = (deps: SponsorDeps) => (deps.store ?? getStore)();

let operatorSeen: { at: number; address: Address | null } | undefined;
/** The operator, read from the contract and remembered for a few minutes: it rarely changes. */
async function defaultOperator(): Promise<Address | null> {
  if (!DECLUB_REWARDS_ADDRESS) return null;
  const now = Date.now();
  if (operatorSeen && now - operatorSeen.at < 300_000) return operatorSeen.address;
  try {
    const address = await chainClient().readContract({ address: DECLUB_REWARDS_ADDRESS, abi: deClubRewardsAbi, functionName: "operator" });
    operatorSeen = { at: now, address };
    return address;
  } catch {
    return operatorSeen?.address ?? null;
  }
}

async function defaultPayment(hash: Hex): Promise<Payment | null> {
  const client = chainClient();
  try {
    const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    return { from: tx.from, to: tx.to ?? null, value: tx.value, ok: receipt.status === "success", at: Number(block.timestamp) };
  } catch {
    return null;
  }
}

const defaultVerify: NonNullable<SponsorDeps["verify"]> = ({ address, message, signature }) => chainClient().verifyMessage({ address, message, signature });

/** The record of a payment already taken in, so asking again repeats the answer and never counts it twice. */
export const sponsorTxKey = (tx: string) => `declub:rewards:sponsor-tx:${tx.toLowerCase()}`;
const lockKey = (tx: string) => `declub:rewards:sponsor-lock:${tx.toLowerCase()}`;

type Recorded = { epoch: number; amount: string; sponsor: string; kind: "owner" | "partner" };

type Refusal = { ok: false; status: number; error: string; message: string };
const refuse = (status: number, error: string, message: string): Refusal => ({ ok: false, status, error, message });

/**
 * Checks a payment against the chain and writes it into the ledger under the name its sender
 * signed. `epoch` forces the epoch (a restore puts it back where it was); without it the payment's
 * block decides. Callers hold the payment's lock and have checked `sponsorTxKey`.
 */
async function acceptPayment(
  store: Store,
  club: ClubEntry,
  input: { tx: Hex; name: string; signature: Hex; epoch?: number },
  deps: SponsorDeps,
): Promise<{ ok: true; recorded: Recorded } | Refusal> {
  const { tx, name, signature } = input;
  const operator = await (deps.operator ?? defaultOperator)();
  if (!operator) return refuse(503, "disabled", "Sponsoring isn't set up on this deployment.");
  const payment = await (deps.payment ?? defaultPayment)(tx);
  if (!payment) return refuse(422, "not_found", "That payment isn't on the chain yet. Try again in a moment.");
  if (!payment.ok) return refuse(422, "failed", "That transaction didn't go through.");
  if (!payment.to || payment.to.toLowerCase() !== operator.toLowerCase())
    return refuse(422, "wrong_recipient", "That payment wasn't sent to the rewards operator.");
  if (payment.value < SPONSOR_MIN_WEI) return refuse(422, "too_small", "That payment is under the least a sponsorship can be.");

  const signed = await (deps.verify ?? defaultVerify)({ address: payment.from, message: sponsorMessage(club.address, tx, name), signature });
  if (!signed) return refuse(422, "bad_signature", "The signature isn't from the wallet that paid.");

  // The Owner's own top-up is labelled as one: the sender is one of the Owner's linked wallets.
  const { owner } = await loadRoles(store, club.address);
  const ownerRow = owner ? await getMember(store, club.address, owner) : null;
  const kind = ownerRow?.wallets.some((w) => w.toLowerCase() === payment.from.toLowerCase()) ? "owner" : "partner";

  // The epoch the payment's block belongs to; the next one when that is built already.
  let n = input.epoch;
  if (n === undefined) {
    const last = await store.get<number>(lastKey());
    n = Math.max(0, epochAt(payment.at, deps.genesis, deps.length));
    if (last !== null && n <= last) n = last + 1;
  }
  const result = await recordSponsor(
    store,
    n,
    { club: club.address, amount: payment.value, sponsor: name, kind, by: getAddress(payment.from), tx, signature },
    deps.now?.(),
  );
  if (result.status === "busy") return refuse(409, "busy", "Another sponsorship is being recorded. Try again in a moment.");
  if (result.status !== "recorded") return refuse(422, "invalid", result.status === "invalid" ? result.message : "That epoch is already built.");

  const recorded: Recorded = { epoch: n, amount: payment.value.toString(), sponsor: name, kind };
  await store.set(sponsorTxKey(tx), recorded);
  return { ok: true, recorded };
}

/** A sponsorship as backed up: all a restore needs, since the chain holds the amount, payer and time. */
export type SponsorBackup = { epoch: number; club: string; tx: string; name: string; signature: string };

/**
 * Puts backed-up sponsorships back after the store was lost (ADR 0053). Each one goes through the
 * checks a new payment does, so a backup can't add what the chain and the sponsor's signature
 * don't support, and one already in the ledger is skipped, so running it twice changes nothing.
 */
export async function restoreSponsors(
  store: Store,
  registry: Registry,
  records: readonly SponsorBackup[],
  deps: SponsorDeps = {},
): Promise<{ restored: number; skipped: { tx: string; reason: string }[] }> {
  let restored = 0;
  const skipped: { tx: string; reason: string }[] = [];
  for (const r of records) {
    const club = isAddress(r.club, { strict: false }) ? registry.clubFor(r.club) : undefined;
    const valid = typeof r.tx === "string" && /^0x[0-9a-fA-F]{64}$/.test(r.tx) && isHex(r.signature) && Number.isInteger(r.epoch) && r.epoch >= 0;
    const name = typeof r.name === "string" ? cleanSponsorName(r.name) : "";
    if (!club || !valid || !name) {
      skipped.push({ tx: String(r.tx), reason: "not a sponsorship this app can restore" });
      continue;
    }
    if (await store.get<Recorded>(sponsorTxKey(r.tx))) {
      skipped.push({ tx: r.tx, reason: "already recorded" });
      continue;
    }
    const taken = await acceptPayment(store, club, { tx: r.tx as Hex, name, signature: r.signature as Hex, epoch: r.epoch }, deps);
    if (taken.ok) restored += 1;
    else skipped.push({ tx: r.tx, reason: taken.message });
  }
  return { restored, skipped };
}

/** GET /api/clubs/[token]/sponsor: where to send the money, the least, and the epoch it would land in. */
export function sponsorInfoHandler(registry: Registry, deps: SponsorDeps = {}) {
  return async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    if (!isAddress(token, { strict: false })) return fail(400, "bad_request", "Give a token address.");
    if (!registry.clubFor(token)) return fail(404, "not_found", "No Club for this asset.");
    const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
    const to = storeOf(deps) ? await (deps.operator ?? defaultOperator)() : null;
    const n = Math.max(0, epochAt(now, deps.genesis, deps.length));
    return Response.json(
      { enabled: to !== null, to, min: SPONSOR_MIN_WEI.toString(), epoch: n, endsAt: epochWindow(n, deps.genesis, deps.length).end },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  };
}

/**
 * POST /api/clubs/[token]/sponsor  { tx, name, signature }: records a payment to the operator as a
 * sponsorship of this Club. It lands in the epoch the payment's block belongs to, or, when that one
 * is already built, the next, so money sent is never left unrecorded.
 */
export function sponsorHandler(registry: Registry, deps: SponsorDeps = {}) {
  return async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    if (!isAddress(token, { strict: false })) return fail(400, "bad_request", "Give a token address.");
    const club = registry.clubFor(token);
    if (!club) return fail(404, "not_found", "No Club for this asset.");
    const store = storeOf(deps);
    if (!store) return fail(503, "disabled", "Sponsoring isn't running on this server.");
    if (!(await withinLimit(store, "sponsor", clientId(request), 20, 60))) return fail(429, "rate_limited", "Too many requests.");

    const body = (await request.json().catch(() => null)) as { tx?: unknown; name?: unknown; signature?: unknown } | null;
    const tx = body?.tx;
    const signature = body?.signature;
    if (typeof tx !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(tx) || typeof signature !== "string" || !isHex(signature)) {
      return fail(400, "bad_request", "Give the payment's transaction hash and your signature.");
    }
    const name = cleanSponsorName(typeof body?.name === "string" ? body.name : "");
    if (!name) return fail(400, "bad_request", "Give the sponsor a name.");

    const known = await store.get<Recorded>(sponsorTxKey(tx));
    if (known) return Response.json({ ok: true, already: true, ...known }, { headers: NO_STORE });
    if ((await store.hit(lockKey(tx), 60)) > 1) return fail(409, "busy", "That payment is being recorded.");
    try {
      const taken = await acceptPayment(store, club, { tx: tx as Hex, name, signature: signature as Hex }, deps);
      if (!taken.ok) return fail(taken.status, taken.error, taken.message);
      const recorded = taken.recorded;
      return Response.json({ ok: true, already: false, ...recorded }, { headers: NO_STORE });
    } finally {
      await store.del(lockKey(tx));
    }
  };
}
