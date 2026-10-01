import type { Address, Hex } from "viem";
import { POOL_URL } from "./config";
import {
  intentToWire,
  parsePoolIntent,
  parseSettlement,
  type Intent,
  type IntentStatus,
  type PoolIntent,
  type Settlement,
} from "./intents";

// The intent pool's HTTP API (matcher/README.md). The pool is not trusted for safety, only
// for liveness: everything it returns is re-checked here (parsePoolIntent recomputes hashes).

export class PoolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** The pool's rejection codes, in words a maker can act on. */
const COPY: Record<string, string> = {
  invalid_intent: "This intent isn't valid",
  deadline_too_soon: "The deadline is too close. Pick a longer one.",
  deadline_too_far: "The deadline is too far away. The pool takes up to 7 days.",
  bad_signature: "The pool didn't accept the signature for this wallet.",
  expired: "This intent has already expired.",
  nonce_used: "That nonce was already used. Try again.",
  balance: "Your wallet doesn't hold everything you're giving.",
  allowance: "Approve the token you're giving first.",
  not_owner: "Your wallet doesn't own an NFT you're giving.",
  not_approved: "Approve the NFT you're giving first.",
  bad_token: "One of the tokens isn't a readable ERC-20 or NFT.",
  not_cancellable: "This intent is no longer in the pool.",
  not_found: "The pool doesn't know this intent.",
};

async function call(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${POOL_URL}${path}`, init);
  } catch {
    throw new PoolError("unreachable", `Can't reach the intent pool at ${POOL_URL}. Is the matcher running?`);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const b = (body ?? {}) as { error?: unknown; message?: unknown };
    const code = typeof b.error === "string" ? b.error : "error";
    const detail = typeof b.message === "string" ? b.message : `the pool answered ${res.status}`;
    // For codes with their own copy the pool's detail is for the logs; invalid_intent's is the point.
    const text = code === "invalid_intent" ? `${COPY[code]}: ${detail}.` : (COPY[code] ?? detail);
    throw new PoolError(code, text);
  }
  return body;
}

export type PoolInfo = { chainId: number; swap: string; matcher: string | null; maxCycle: number };

export async function getInfo(): Promise<PoolInfo> {
  const body = (await call("/info")) as Partial<PoolInfo>;
  if (typeof body.chainId !== "number" || typeof body.swap !== "string") {
    throw new PoolError("bad_response", "That isn't an intent pool.");
  }
  return { chainId: body.chainId, swap: body.swap, matcher: body.matcher ?? null, maxCycle: body.maxCycle ?? 4 };
}

export type ListParams = { status?: IntentStatus | "all"; maker?: Address; limit?: number };

/** The book, newest first. The pool returns oldest first, and unreadable rows are left out. */
export async function listIntents({ status = "open", maker, limit = 200 }: ListParams = {}): Promise<PoolIntent[]> {
  const q = new URLSearchParams({ status, limit: String(limit) });
  if (maker) q.set("maker", maker);
  const body = (await call(`/intents?${q}`)) as { intents?: unknown };
  const rows = Array.isArray(body.intents) ? body.intents : [];
  return rows
    .map(parsePoolIntent)
    .filter((r): r is PoolIntent => r !== null)
    .reverse();
}

export async function getIntent(hash: Hex): Promise<PoolIntent | null> {
  try {
    return parsePoolIntent(await call(`/intents/${hash}`));
  } catch (error) {
    if (error instanceof PoolError && error.code === "not_found") return null;
    throw error;
  }
}

export async function listSettlements({ maker, limit = 50 }: { maker?: Address; limit?: number } = {}): Promise<Settlement[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (maker) q.set("maker", maker);
  const body = (await call(`/settlements?${q}`)) as { settlements?: unknown };
  const rows = Array.isArray(body.settlements) ? body.settlements : [];
  return rows.map(parseSettlement).filter((s): s is Settlement => s !== null);
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export async function submitIntent(intent: Intent, signature: Hex): Promise<{ hash: Hex; status: IntentStatus }> {
  const out = (await call("/intents", json("POST", { intent: intentToWire(intent), signature }))) as {
    hash?: Hex;
    status?: IntentStatus;
  };
  if (!out.hash || !out.status) throw new PoolError("bad_response", "The pool's answer wasn't understood.");
  return { hash: out.hash, status: out.status };
}

export async function cancelIntent(hash: Hex, signature: Hex): Promise<void> {
  await call(`/intents/${hash}`, json("DELETE", { signature }));
}
