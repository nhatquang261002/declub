"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { useNow } from "@/hooks/useNow";
import { clubRewards as rewardsContract } from "@/lib/contracts";
import type { ClaimableLeaf } from "@/lib/rewards";
import type { ClubRewardsView } from "@/lib/server/rewards";

// Club Rewards (ADR 0022). The server knows what each epoch pays whom; the chain knows which
// epochs are published, open and claimed. Both are read here and joined per leaf.

type Base = { enabled: boolean; contract: Address | null; epoch: number; endsAt: number };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { message?: unknown } | null)?.message;
    throw new Error(typeof message === "string" ? message : `The server answered ${res.status}.`);
  }
  return body as T;
}

/** A Club's fees and pools in the latest epochs, what rolls over, and who earned. */
export function useClubRewards(token: string) {
  const query = useQuery({
    queryKey: ["club-rewards", token.toLowerCase()],
    queryFn: () => getJson<Base & ClubRewardsView & { xReach?: boolean }>(`/api/clubs/${token}/rewards`),
    refetchInterval: 60_000,
    retry: 1,
  });
  return { data: query.data, isLoading: query.isLoading, error: query.error };
}

/** Where one leaf stands. */
export type LeafState =
  /** Built, but the operator hasn't published (and funded) the epoch yet. */
  | "unpublished"
  /** Published; claims open at `openAt`. */
  | "waiting"
  | "claimable"
  | "claimed"
  /** Swept after the claim window: it can't be paid any more. */
  | "expired";

export type MyLeaf = ClaimableLeaf & { state: LeafState; openAt?: number };

/** `account`'s leaves with their state on chain, and the ones it can claim now. */
export function useMyRewards(account: Address | undefined) {
  const query = useQuery({
    queryKey: ["my-rewards", account?.toLowerCase()],
    queryFn: () => getJson<Base & { leaves: ClaimableLeaf[] }>(`/api/rewards/me?account=${account}`),
    enabled: !!account,
    refetchInterval: 60_000,
    retry: 1,
  });
  const leaves = useMemo(() => query.data?.leaves ?? [], [query.data]);

  const reads = useReadContracts({
    contracts: leaves.flatMap((leaf) => [
      { ...rewardsContract!, functionName: "epochs", args: [BigInt(leaf.epoch)] } as const,
      { ...rewardsContract!, functionName: "isClaimed", args: [BigInt(leaf.epoch), leaf.account] } as const,
    ]),
    query: { enabled: !!rewardsContract && leaves.length > 0, refetchInterval: 15_000 },
  });

  const now = useNow(15_000);
  const mine: MyLeaf[] = leaves.map((leaf, i) => {
    const epoch = reads.data?.[2 * i];
    const claimed = reads.data?.[2 * i + 1];
    if (epoch?.status !== "success" || claimed?.status !== "success") return { ...leaf, state: "unpublished" };
    const e = epoch.result as { root: string; openAt: bigint; closed: boolean };
    const openAt = Number(e.openAt);
    if (claimed.result) return { ...leaf, state: "claimed", openAt };
    if (/^0x0+$/.test(e.root)) return { ...leaf, state: "unpublished" };
    if (e.closed) return { ...leaf, state: "expired", openAt };
    return { ...leaf, state: now >= openAt ? "claimable" : "waiting", openAt };
  });

  const sum = (state: LeafState) => mine.filter((l) => l.state === state).reduce((total, l) => total + BigInt(l.amount), 0n);
  return {
    enabled: query.data?.enabled ?? false,
    configured: !!rewardsContract,
    epoch: query.data?.epoch,
    endsAt: query.data?.endsAt,
    leaves: mine,
    claimable: mine.filter((l) => l.state === "claimable"),
    totals: { claimable: sum("claimable"), waiting: sum("waiting") + sum("unpublished"), claimed: sum("claimed") },
    isLoading: query.isLoading || reads.isLoading,
    error: query.error ?? reads.error,
  };
}
