"use client";

import { useCallback, useState } from "react";
import type {
  Abi,
  ContractFunctionArgs,
  ContractFunctionName,
  Hash,
  TransactionReceipt,
} from "viem";
import { useConfig } from "wagmi";
import {
  getConnection,
  getPublicClient,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import { describeError, type AppError } from "@/lib/errors";
import { useToast } from "@/components/Toast";
import { mayFill, mayReport, reportTx } from "@/lib/fillReport";
import { chain } from "@/lib/wagmi";

// idle → simulating → awaiting-signature → pending → confirmed
//                ╰──────────────┴────────────┴──► error (decoded)
export type TxState =
  | { status: "idle" }
  | { status: "switching-chain" }
  | { status: "simulating" }
  | { status: "awaiting-signature" }
  // Signed intents only (useSignFlow): the signature is made, the pool is being told.
  | { status: "posting" }
  | { status: "pending"; hash: Hash }
  | { status: "confirmed"; hash: Hash }
  | ({ status: "error"; hash?: Hash } & AppError);

type Mutability = "nonpayable" | "payable";

export type WriteCall<
  abi extends Abi = Abi,
  functionName extends ContractFunctionName<abi, Mutability> = ContractFunctionName<
    abi,
    Mutability
  >,
> = {
  address: `0x${string}`;
  abi: abi;
  functionName: functionName;
  args: ContractFunctionArgs<abi, Mutability, functionName>;
  value?: bigint;
};

// Monad charges for the gas limit, not gas used, so keep the buffer small.
const GAS_BUFFER_PERCENT = 110n;

/**
 * Runs one contract write through simulate → sign → receipt, and refreshes every query
 * once it lands. `run` resolves to the receipt, or null if anything failed; the reason
 * is in `state`.
 */
export function useTxFlow() {
  const config = useConfig();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const run = useCallback(
    async <const abi extends Abi, functionName extends ContractFunctionName<abi, Mutability>>(
      call: WriteCall<abi, functionName>,
    ): Promise<TransactionReceipt | null> => {
      let hash: Hash | undefined;
      try {
        const connection = getConnection(config);
        if (!connection.address) throw new Error("Connect a wallet first.");
        const account = connection.address;

        if (connection.chainId !== chain.id) {
          setState({ status: "switching-chain" });
          await switchChain(config, { chainId: chain.id });
        }

        // Surface reverts (with the decoded custom error) before the wallet opens.
        setState({ status: "simulating" });
        // The generic WriteCall can't be narrowed to wagmi's overloads; the call site is typed.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const request = { ...call, account, chainId: chain.id } as any;
        await simulateContract(config, request);
        const client = getPublicClient(config, { chainId: chain.id });
        if (!client) throw new Error(`No RPC configured for chain ${chain.id}.`);
        const gas = await client.estimateContractGas(request);

        setState({ status: "awaiting-signature" });
        hash = await writeContract(config, { ...request, gas: (gas * GAS_BUFFER_PERCENT) / 100n });

        setState({ status: "pending", hash });
        const receipt = await waitForTransactionReceipt(config, { hash, chainId: chain.id });
        if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");

        setState({ status: "confirmed", hash });
        // History needs the filler on record before it refetches (lib/fillReport.ts).
        if (mayFill(call)) await reportTx(hash);
        // A new deal only feeds a Club, so nothing waits for it.
        else if (mayReport(call)) void reportTx(hash);
        await queryClient.invalidateQueries();
        return receipt;
      } catch (error) {
        // The toast is what the user sees wherever they've scrolled; `state` keeps the record
        // beside the button for <TxStatus>.
        const described = describeError(error);
        setState({ status: "error", ...described, hash });
        toast.error(described);
        return null;
      }
    },
    [config, queryClient, toast],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  const busy =
    state.status !== "idle" && state.status !== "confirmed" && state.status !== "error";

  return { state, run, reset, busy };
}
