"use client";

import { useCallback, useState } from "react";
import type { Address, Hash } from "viem";
import { useConfig } from "wagmi";
import { getConnection, sendTransaction, signMessage, switchChain, waitForTransactionReceipt } from "wagmi/actions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/Toast";
import { describeError } from "@/lib/errors";
import { sponsorMessage } from "@/lib/rewards";
import { chain } from "@/lib/wagmi";
import type { TxState } from "./useTxFlow";


// Sponsoring an epoch (ADR 0036): pay the operator, then sign to put your name on the payment.
//   idle → switching-chain → awaiting-signature → pending → awaiting-signature → posting → confirmed
//                       ╰──────────────┴──────────────┴──────────────┴────────────► error (decoded)
// It reuses TxState so TxButton and TxStatus work unchanged. If the payment lands but the signing or
// the recording fails, `unrecorded` keeps the hash so "Finish recording" can retry without paying again.

export type SponsorInfo = { enabled: boolean; to: Address | null; min: string; epoch: number; endsAt: number };
export type SponsorRecorded = { epoch: number; amount: string; sponsor: string; kind: "owner" | "partner"; already?: boolean };

/** Where a sponsor sends the money, and the least that can be sent. */
export function useSponsorInfo(token: string) {
  const query = useQuery({
    queryKey: ["club-sponsor", token.toLowerCase()],
    queryFn: async () => {
      const res = await fetch(`/api/clubs/${token}/sponsor`);
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      return (await res.json()) as SponsorInfo;
    },
    staleTime: 60_000,
    retry: 1,
  });
  return { info: query.data, isLoading: query.isLoading };
}

export function useSponsorFlow(token: string) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<TxState>({ status: "idle" });
  const [unrecorded, setUnrecorded] = useState<{ hash: Hash; name: string } | null>(null);
  const [recorded, setRecorded] = useState<SponsorRecorded | null>(null);

  /** Signs for `hash` under `name`, then has the server check the payment and record it. */
  const record = useCallback(
    async (hash: Hash, name: string, from: Address): Promise<SponsorRecorded> => {
      setState({ status: "awaiting-signature" });
      const signature = await signMessage(config, { account: from, message: sponsorMessage(token, hash, name) });
      setState({ status: "posting" });
      // The node the server reads from may be a moment behind the one the wallet used.
      let last: { message?: string } | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetch(`/api/clubs/${token}/sponsor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tx: hash, name, signature }),
        });
        const body = (await res.json().catch(() => null)) as (SponsorRecorded & { error?: string; message?: string }) | null;
        if (res.ok && body) return body;
        last = body;
        if (body?.error !== "not_found" && body?.error !== "busy") break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error(last?.message ?? "The server couldn't record the payment.");
    },
    [config, token],
  );

  const finish = useCallback(
    async (hash: Hash, name: string, from: Address) => {
      const out = await record(hash, name, from);
      setUnrecorded(null);
      setRecorded(out);
      setState({ status: "syncing", hash });
      await queryClient.invalidateQueries();
      setState({ status: "confirmed", hash });
      return out;
    },
    [queryClient, record],
  );

  /** Pays `amount` wei to `to`, then records it under `name`. */
  const run = useCallback(
    async (to: Address, amount: bigint, name: string): Promise<SponsorRecorded | null> => {
      let hash: Hash | undefined;
      try {
        const connection = getConnection(config);
        if (!connection.address) throw new Error("Connect a wallet first.");
        const from = connection.address;
        setRecorded(null);
        if (connection.chainId !== chain.id) {
          setState({ status: "switching-chain" });
          await switchChain(config, { chainId: chain.id });
        }
        setState({ status: "awaiting-signature" });
        hash = await sendTransaction(config, { account: from, to, value: amount, chainId: chain.id });
        setUnrecorded({ hash, name });
        setState({ status: "pending", hash });
        const receipt = await waitForTransactionReceipt(config, { hash, chainId: chain.id });
        if (receipt.status !== "success") throw new Error("The payment reverted on-chain.");
        return await finish(hash, name, from);
      } catch (error) {
        const described = describeError(error);
        setState({ status: "error", ...described, hash });
        toast.error(described);
        return null;
      }
    },
    [config, finish, toast],
  );

  /** Retries the signing and recording of a payment that already went through (nothing is paid again). */
  const retry = useCallback(
    async (hash: Hash, name: string): Promise<SponsorRecorded | null> => {
      try {
        const connection = getConnection(config);
        if (!connection.address) throw new Error("Connect the wallet that paid.");
        return await finish(hash, name, connection.address);
      } catch (error) {
        const described = describeError(error);
        setState({ status: "error", ...described, hash });
        toast.error(described);
        return null;
      }
    },
    [config, finish, toast],
  );

  const reset = useCallback(() => {
    setState({ status: "idle" });
    setRecorded(null);
  }, []);
  const busy = state.status !== "idle" && state.status !== "confirmed" && state.status !== "error";
  return { state, run, retry, reset, busy, unrecorded, recorded };
}
