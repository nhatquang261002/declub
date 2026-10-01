import { type Address, type Hex, getAddress, isAddress, isHex } from "viem";
import type { Asset, Intent, SignedIntent } from "./types.ts";

/** An HTTP/JSON-safe shape: every bigint is a decimal string. */
export interface WireAsset {
  assetType: number;
  token: Address;
  id: string;
  amount: string;
}
export interface WireIntent {
  maker: Address;
  give: WireAsset[];
  want: WireAsset[];
  feeToken: Address;
  fee: string;
  deadline: string;
  nonce: string;
}

export class WireError extends Error {}

const U64_MAX = 2n ** 64n - 1n;
const U256_MAX = 2n ** 256n - 1n;
/** Bound the work done before the contract's own limits (10 per side) are checked. */
const MAX_ARRAY = 64;

export function assetToWire(a: Asset): WireAsset {
  return { assetType: a.assetType, token: a.token, id: a.id.toString(), amount: a.amount.toString() };
}

export function intentToWire(i: Intent): WireIntent {
  return {
    maker: i.maker,
    give: i.give.map(assetToWire),
    want: i.want.map(assetToWire),
    feeToken: i.feeToken,
    fee: i.fee.toString(),
    deadline: i.deadline.toString(),
    nonce: i.nonce.toString(),
  };
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new WireError(`${what} must be an object`);
  }
  return v as Record<string, unknown>;
}

function uint(v: unknown, what: string, max: bigint): bigint {
  if (typeof v !== "string" || !/^(0|[1-9][0-9]*)$/.test(v)) {
    throw new WireError(`${what} must be a decimal string`);
  }
  const n = BigInt(v);
  if (n > max) throw new WireError(`${what} is out of range`);
  return n;
}

function address(v: unknown, what: string): Address {
  if (typeof v !== "string" || !isAddress(v)) throw new WireError(`${what} must be an address`);
  return getAddress(v);
}

function assetFromWire(v: unknown, what: string): Asset {
  const o = obj(v, what);
  const t = o.assetType;
  if (typeof t !== "number" || !Number.isInteger(t) || t < 0 || t > 255) {
    throw new WireError(`${what}.assetType must be a uint8`);
  }
  return {
    assetType: t,
    token: address(o.token, `${what}.token`),
    id: uint(o.id, `${what}.id`, U256_MAX),
    amount: uint(o.amount, `${what}.amount`, U256_MAX),
  };
}

function assets(v: unknown, what: string): Asset[] {
  if (!Array.isArray(v)) throw new WireError(`${what} must be an array`);
  if (v.length > MAX_ARRAY) throw new WireError(`${what} is too long`);
  return v.map((a, i) => assetFromWire(a, `${what}[${i}]`));
}

export function intentFromWire(v: unknown): Intent {
  const o = obj(v, "intent");
  return {
    maker: address(o.maker, "intent.maker"),
    give: assets(o.give, "intent.give"),
    want: assets(o.want, "intent.want"),
    feeToken: address(o.feeToken, "intent.feeToken"),
    fee: uint(o.fee, "intent.fee", U256_MAX),
    deadline: uint(o.deadline, "intent.deadline", U64_MAX),
    nonce: uint(o.nonce, "intent.nonce", U256_MAX),
  };
}

export function hexString(v: unknown, what: string): Hex {
  if (typeof v !== "string" || !isHex(v, { strict: true })) {
    throw new WireError(`${what} must be a hex string`);
  }
  return v;
}

/** The body of `POST /intents`: `{ intent, signature }`. */
export function signedFromWire(v: unknown): SignedIntent {
  const o = obj(v, "body");
  return { intent: intentFromWire(o.intent), signature: hexString(o.signature, "signature") };
}
