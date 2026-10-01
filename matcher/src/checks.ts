import type { Address } from "viem";
import { isAddressEqual } from "viem";
import { erc20Abi, erc721Abi, intentsAbi } from "./abi.ts";
import type { Reader } from "./chain.ts";
import { isRevert } from "./errors.ts";
import { type Asset, AssetType, type Intent } from "./types.ts";

export type ProblemCode =
  | "expired"
  | "nonce_used"
  | "balance"
  | "allowance"
  | "fee_balance"
  | "fee_allowance"
  | "not_owner"
  | "not_approved"
  | "bad_token";

export interface Problem {
  code: ProblemCode;
  detail: string;
}

/** An RPC failure is not a problem with the intent, so it propagates; a revert is one. */
async function read<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (isRevert(err)) return null;
    throw err;
  }
}

async function assetProblem(
  reader: Reader,
  swap: Address,
  maker: Address,
  a: Asset,
): Promise<Problem | null> {
  if (a.assetType === AssetType.ERC20) {
    const [balance, allowance] = await Promise.all([
      read(reader.readContract({ address: a.token, abi: erc20Abi, functionName: "balanceOf", args: [maker] })),
      read(
        reader.readContract({
          address: a.token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [maker, swap],
        }),
      ),
    ]);
    if (balance === null || allowance === null) {
      return { code: "bad_token", detail: `${a.token} is not an ERC-20` };
    }
    if (balance < a.amount) {
      return { code: "balance", detail: `${a.token}: balance ${balance} < ${a.amount}` };
    }
    if (allowance < a.amount) {
      return { code: "allowance", detail: `${a.token}: allowance ${allowance} < ${a.amount}` };
    }
    return null;
  }

  const [owner, approved, approvedForAll] = await Promise.all([
    read(reader.readContract({ address: a.token, abi: erc721Abi, functionName: "ownerOf", args: [a.id] })),
    read(reader.readContract({ address: a.token, abi: erc721Abi, functionName: "getApproved", args: [a.id] })),
    read(
      reader.readContract({
        address: a.token,
        abi: erc721Abi,
        functionName: "isApprovedForAll",
        args: [maker, swap],
      }),
    ),
  ]);
  if (owner === null) return { code: "bad_token", detail: `${a.token} #${a.id}: no owner` };
  if (!isAddressEqual(owner, maker)) {
    return { code: "not_owner", detail: `${a.token} #${a.id} is owned by ${owner}` };
  }
  const ok = (approved !== null && isAddressEqual(approved, swap)) || approvedForAll === true;
  return ok ? null : { code: "not_approved", detail: `${a.token} #${a.id} is not approved` };
}

/**
 * The protocol fee comes out of the maker's wallet after the gives move, in the same token a give
 * may use, so the fee is checked on top of whatever the maker gives of that token. (Anything the
 * maker receives in the same cycle is ignored: that makes this check conservative, never wrong
 * the other way.)
 */
async function feeProblem(reader: Reader, swap: Address, intent: Intent): Promise<Problem | null> {
  if (intent.fee === 0n) return null;
  const token = intent.feeToken;
  const alsoGiven = intent.give
    .filter((a) => a.assetType === AssetType.ERC20 && isAddressEqual(a.token, token))
    .reduce((sum, a) => sum + a.amount, 0n);
  const needed = intent.fee + alsoGiven;
  const [balance, allowance] = await Promise.all([
    read(reader.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [intent.maker] })),
    read(
      reader.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [intent.maker, swap],
      }),
    ),
  ]);
  if (balance === null || allowance === null) {
    return { code: "bad_token", detail: `fee token ${token} is not an ERC-20` };
  }
  if (balance < needed) {
    return { code: "fee_balance", detail: `fee token ${token}: balance ${balance} < ${needed} (fee ${intent.fee})` };
  }
  if (allowance < needed) {
    return { code: "fee_allowance", detail: `fee token ${token}: allowance ${allowance} < ${needed} (fee ${intent.fee})` };
  }
  return null;
}

/**
 * Whether `intent` could settle right now: not expired, nonce unused, and the maker holds and has
 * approved everything in `give` and the protocol fee. This is only a plausibility check, the real answer is the
 * `settle` simulation, but it is how the pool prunes and how the matcher finds who broke a cycle.
 * Returns the first problem, by priority (expired, nonce, each give asset, then the fee), or null.
 */
export async function checkIntent(
  reader: Reader,
  swap: Address,
  intent: Intent,
  nowSec: number,
): Promise<Problem | null> {
  if (intent.deadline < BigInt(nowSec)) {
    return { code: "expired", detail: `deadline ${intent.deadline} has passed` };
  }
  const [used, ...problems] = await Promise.all([
    reader.readContract({
      address: swap,
      abi: intentsAbi,
      functionName: "isNonceUsed",
      args: [intent.maker, intent.nonce],
    }),
    ...intent.give.map((a) => assetProblem(reader, swap, intent.maker, a)),
    feeProblem(reader, swap, intent),
  ]);
  if (used) return { code: "nonce_used", detail: `nonce ${intent.nonce} is used` };
  return problems.find((p) => p !== null) ?? null;
}
