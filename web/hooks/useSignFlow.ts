"use client";

import { useCallback, useState } from "react";
import type { Address, Hex } from "viem";
import { useConfig } from "wagmi";
import { getConnection, readContracts, signTypedData, switchChain } from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import { CHAIN_ID, ON_DEAL_INTENTS_ADDRESS } from "@/lib/config";
import { swapIntents } from "@/lib/contracts";
import { describeError } from "@/lib/errors";
import { useToast } from "@/components/Toast";
import { cancelTypedData, intentHash, intentTypedData, type Intent } from "@/lib/intents";
import { cancelIntent, listIntents, submitIntent } from "@/lib/pool";
import { chain } from "@/lib/wagmi";
import type { Asset } from "@/lib/assets";
import type { TxState } from "./useTxFlow";

// Signing an intent costs no gas, so this is the signed-message sibling of useTxFlow:
//   idle → switching-chain → awaiting-signature → posting → idle (the caller shows the result)
//                       ╰──────────────┴────────────────────► error (decoded)
// It reuses TxState so TxButton and TxStatus work unchanged.

/** How many nonces past the highest one this wallet has used are checked on-chain at once. */
const NONCE_PROBE = 16n;

/**
 * An unused nonce for `maker`. Nonces are unordered, so any unused one works, but packing them
 * into the same 256-bit word keeps the matcher's settlement cheaper than random ones would.
 * Start above everything this wallet has ever posted to the pool (cancelled intents included:
 * their signatures could still settle, so their nonces must not be reused), then skip any the
 * contract already marks used.
 */
async function freeNonce(config: ReturnType<typeof useConfig>, maker: Address): Promise<bigint> {
  const known = await listIntents({ status: "all", maker, limit: 500 });
  let start = known.reduce((max, row) => (row.intent.nonce >= max ? row.intent.nonce + 1n : max), 0n);
  for (;;) {
    const candidates = Array.from({ length: Number(NONCE_PROBE) }, (_, i) => start + BigInt(i));
    const used = await readContracts(config, {
      contracts: candidates.map((nonce) => ({ ...swapIntents!, functionName: "isNonceUsed", args: [maker, nonce] }) as const),
      allowFailure: false,
    });
    const free = candidates.find((_, i) => !used[i]);
    if (free !== undefined) return free;
    start += NONCE_PROBE;
  }
}

export type NewIntent = { give: Asset[]; want: Asset[]; ttlSeconds: number };

export function useSignFlow() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<TxState>({ status: "idle" });

  /** Connects the chain, then runs `work` with the connected account. Resolves to null on failure. */
  const guarded = useCallback(
    async <T,>(work: (account: Address) => Promise<T>): Promise<T | null> => {
      try {
        if (!ON_DEAL_INTENTS_ADDRESS || !swapIntents) throw new Error("Intents aren't enabled on this deployment.");
        const connection = getConnection(config);
        if (!connection.address) throw new Error("Connect a wallet first.");
        if (connection.chainId !== chain.id) {
          setState({ status: "switching-chain" });
          await switchChain(config, { chainId: CHAIN_ID });
        }
        const out = await work(connection.address);
        setState({ status: "idle" });
        await queryClient.invalidateQueries();
        return out;
      } catch (error) {
        const described = describeError(error);
        setState({ status: "error", ...described });
        toast.error(described);
        return null;
      }
    },
    [config, queryClient, toast],
  );

  /** Signs a new intent and posts it. Resolves to its hash, or null (the reason is in `state`). */
  const post = useCallback(
    ({ give, want, ttlSeconds }: NewIntent): Promise<Hex | null> =>
      guarded(async (maker) => {
        const nonce = await freeNonce(config, maker);
        // The fee is read from the contract at the moment of signing and signed as the most this
        // maker pays (ADR 0018): a later cut charges less, a later raise above it makes the intent
        // stale until it is signed again.
        const [feeToken, fee] = await readContracts(config, {
          contracts: [
            { ...swapIntents!, functionName: "FEE_TOKEN" },
            { ...swapIntents!, functionName: "fee" },
          ] as const,
          allowFailure: false,
        });
        const intent: Intent = {
          maker,
          give,
          want,
          feeToken,
          maxFee: fee,
          // Counted from the moment of signing, so a slow wallet doesn't eat into the lifetime.
          deadline: BigInt(Math.floor(Date.now() / 1000) + ttlSeconds),
          nonce,
        };
        setState({ status: "awaiting-signature" });
        const signature = await signTypedData(config, {
          account: maker,
          ...intentTypedData(ON_DEAL_INTENTS_ADDRESS!, intent),
        });
        setState({ status: "posting" });
        const out = await submitIntent(intent, signature);
        // The pool computes the same struct hash; if it ever disagrees the app has drifted.
        if (out.hash.toLowerCase() !== intentHash(intent).toLowerCase()) {
          throw new Error("The pool and this app disagree about the intent's id. Please report this.");
        }
        return out.hash;
      }),
    [config, guarded],
  );

  /** Takes an intent out of the pool. Needs the maker's signature, but no gas. */
  const cancel = useCallback(
    (hash: Hex): Promise<boolean | null> =>
      guarded(async (maker) => {
        setState({ status: "awaiting-signature" });
        const signature = await signTypedData(config, {
          account: maker,
          ...cancelTypedData(ON_DEAL_INTENTS_ADDRESS!, hash),
        });
        setState({ status: "posting" });
        await cancelIntent(hash, signature);
        return true;
      }),
    [config, guarded],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  const busy = state.status !== "idle" && state.status !== "error";
  return { state, post, cancel, reset, busy };
}
