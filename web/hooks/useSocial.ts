"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { Address, Hex } from "viem";
import { useConfig, useConnection } from "wagmi";
import { getConnection, signTypedData, switchChain } from "wagmi/actions";
import { useToast } from "@/components/Toast";
import { useAccessToken } from "@/hooks/useAccessToken";
import { call } from "@/hooks/useClubMembership";
import { CHAIN_ID } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { followTypedData, signingTime, type FollowMessage, type postTypedData, type replyTypedData } from "@/lib/social";

// Signed social records (ADR 0023): posts and follows are signed by the wallet, so they can be
// carried elsewhere and checked by anyone. Signing costs no gas and moves nothing.

/** Where a signed write is: waiting on the wallet, or on the server once it is signed. */
export type SocialStage = "signing" | "sending";

type Typed = ReturnType<typeof postTypedData> | ReturnType<typeof followTypedData> | ReturnType<typeof replyTypedData>;

/**
 * Signs a social record with the connected wallet. When `expected` is given (a post must come from
 * the member's Club wallet), any other connected wallet is refused before the wallet opens.
 */
export function useSocialSign() {
  const config = useConfig();
  return useCallback(
    async (typed: Typed, expected?: string): Promise<{ signature: Hex; signer: Address }> => {
      const connection = getConnection(config);
      if (!connection.address) throw new Error("Connect a wallet first.");
      if (expected && connection.address.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(`Switch to your Club wallet ${shortAddress(expected)} to sign. That’s the wallet your posts are shown under.`);
      }
      // Wallets refuse typed data for another chain than the one they're on.
      if (connection.chainId !== CHAIN_ID) await switchChain(config, { chainId: CHAIN_ID });
      // The generic union doesn't narrow to wagmi's overloads; both shapes are valid typed data.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signature = await signTypedData(config, { account: connection.address, ...(typed as any) });
      return { signature, signer: connection.address };
    },
    [config],
  );
}

type FollowsView = { enabled: boolean; follows: { message: FollowMessage }[]; followers: number };

/** Who the connected wallet follows, lowercase, and a follow/unfollow that signs and records it. */
export function useFollows() {
  const { address } = useConnection();
  const getToken = useAccessToken();
  const queryClient = useQueryClient();
  const toast = useToast();
  const sign = useSocialSign();
  const key = ["follows", address?.toLowerCase()];
  const [stage, setStage] = useState<SocialStage>();

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/wallets/${address}/follows`);
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      return (await res.json()) as FollowsView;
    },
    enabled: !!address,
    retry: 1,
  });
  const following = new Set((query.data?.follows ?? []).map((f) => f.message.target.toLowerCase()));

  const change = useMutation({
    mutationFn: async ({ target, follow }: { target: string; follow: boolean }) => {
      if (!address) throw new Error("Connect a wallet first.");
      const message: FollowMessage = { follower: address, target: target as Address, following: follow, at: signingTime() };
      try {
        setStage("signing");
        const { signature } = await sign(followTypedData(message));
        setStage("sending");
        return await call(getToken!, "POST", "/api/follows", { message, signature });
      } finally {
        setStage(undefined);
      }
    },
    onSuccess: (_, { follow }) => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["club-posts"] });
      toast.show({ tone: "success", title: follow ? "Following." : "Unfollowed." });
    },
    onError: (error) => toast.error(error),
  });

  return {
    /** Signed in with a wallet connected: following is possible. */
    can: !!address && !!getToken && query.data?.enabled !== false,
    me: address,
    following,
    toggle: (target: string) => change.mutate({ target, follow: !following.has(target.toLowerCase()) }),
    pending: change.isPending ? change.variables?.target.toLowerCase() : undefined,
    /** Which step the pending follow is on. */
    stage,
  };
}
