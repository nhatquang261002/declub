"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/Toast";
import { useAccessToken, type GetAccessToken } from "@/hooks/useAccessToken";
import { useSocialSign } from "@/hooks/useSocial";
import { bearerInit } from "@/lib/bearer";
import { MEMBERS_PAGE, type MemberSort, type MembersView } from "@/lib/members";
import { joinTypedData, signingTime } from "@/lib/social";
import type { Address } from "viem";

// Membership is per user, so it needs the Privy access token (ADR 0012's pattern). Without sign-in
// or without a server that keeps it, a Club is read-only, and these hooks say so rather than fail.

export async function call<T>(getToken: GetAccessToken, method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error("Sign in again to continue.");
  const res = await fetch(path, bearerInit(token, method, body));
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { message?: unknown } | null)?.message;
    throw new Error(typeof message === "string" ? message : `The server answered ${res.status}.`);
  }
  return data as T;
}

export type ViewerRole = "admin" | "owner" | "moderator" | "member";
type Membership = {
  enabled: boolean;
  member?: boolean;
  wallet?: string;
  holder?: boolean;
  joinedAt?: number;
  role?: ViewerRole;
  /** The address a membership is signed for, and whether it is, for the wallet shown (ADR 0053). */
  club?: string;
  signed?: boolean;
};

/** The signed-in user's membership of one Club, with join and leave. */
export function useClubMembership(token: string) {
  const getToken = useAccessToken();
  const queryClient = useQueryClient();
  const toast = useToast();
  const sign = useSocialSign();
  const key = ["club-membership", token.toLowerCase()];
  const path = `/api/clubs/${token}/membership`;

  const query = useQuery({
    queryKey: key,
    queryFn: () => call<Membership>(getToken!, "GET", path),
    enabled: !!getToken,
    staleTime: 60_000,
    retry: 1,
  });

  /**
   * Signs "this wallet is on this Club's list" with the Club wallet and keeps it on the server: the
   * proof the list can be rebuilt from (ADR 0053). It costs no gas and changes nothing on the Club.
   */
  const backUp = async (membership: Membership): Promise<Membership> => {
    if (!membership.club || !membership.wallet) return membership;
    const message = { club: membership.club as Address, wallet: membership.wallet as Address, at: signingTime() };
    const { signature } = await sign(joinTypedData(message), membership.wallet);
    await call(getToken!, "PUT", path, { message, signature });
    return { ...membership, signed: true };
  };

  const useChange = (method: "POST" | "DELETE") =>
    useMutation({
      // Joining asks for the signature straight after, but a member who declines is still a member:
      // the button on their membership asks again.
      mutationFn: async () => {
        const data = await call<Membership>(getToken!, method, path);
        if (method !== "POST" || !data.member) return data;
        return backUp(data).catch(() => data);
      },
      onSuccess: (data) => {
        queryClient.setQueryData(key, data);
        // Counts, the leaderboard and "your clubs" all move with a join or a leave.
        void queryClient.invalidateQueries({ queryKey: ["clubs"] });
        void queryClient.invalidateQueries({ queryKey: ["club-members", token.toLowerCase()] });
        void queryClient.invalidateQueries({ queryKey: ["my-clubs"] });
        // A Club moves between the timeline's "yours" and "others" with a join or a leave.
        void queryClient.invalidateQueries({ queryKey: ["timeline"] });
      },
      onError: (error) => toast.error(error),
    });
  const join = useChange("POST");
  const leave = useChange("DELETE");
  const backup = useMutation({
    mutationFn: () => backUp(query.data!),
    onSuccess: (data) => queryClient.setQueryData(key, data),
    onError: (error) => toast.error(error),
  });

  return {
    /** Signed in (and the app has sign-in at all). */
    signedIn: !!getToken,
    /** False when the server keeps no memberships; the Club is then read-only. */
    enabled: query.data?.enabled !== false,
    isLoading: !!getToken && query.isLoading,
    member: query.data?.member === true,
    holder: query.data?.holder === true,
    wallet: query.data?.wallet,
    /** `member` for a plain member; undefined for a visitor. An admin holds `admin` even in Clubs they never joined. */
    role: query.data?.member || query.data?.role === "admin" ? (query.data.role ?? "member") : undefined,
    join: () => join.mutate(),
    leave: () => leave.mutate(),
    pending: join.isPending || leave.isPending,
    /** The membership is signed, so the Club's list can be rebuilt from it. False for a member who hasn't (or who joined before this). */
    signed: query.data?.signed === true,
    /** Signs the membership with the Club wallet. */
    backup: () => backup.mutate(),
    backingUp: backup.isPending,
    /** Asks again: the server re-reads a non-Holder's wallets (at most once a minute), so one who just bought in gets the badge. */
    recheck: () => {
      void query.refetch().then((r) => {
        if (r.data?.holder) void queryClient.invalidateQueries({ queryKey: ["club-members", token.toLowerCase()] });
      });
    },
    rechecking: query.isFetching,
    error: query.error,
  };
}

/** The Clubs (token addresses, lowercase) the signed-in user belongs to. */
export function useMyClubs(): string[] {
  const getToken = useAccessToken();
  const query = useQuery({
    queryKey: ["my-clubs"],
    queryFn: () => call<{ enabled: boolean; clubs?: string[] }>(getToken!, "GET", "/api/me/clubs"),
    enabled: !!getToken,
    staleTime: 60_000,
    retry: 1,
  });
  return query.data?.clubs ?? [];
}

/** A Club's leaderboard. Public. */
export function useClubMembers(token: string, sort: MemberSort, page = 1, size = MEMBERS_PAGE, search = "") {
  const query = useQuery({
    queryKey: ["club-members", token.toLowerCase(), sort, page, size, search],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetch(`/api/clubs/${token}/members?sort=${sort}&page=${page}&size=${size}${search ? `&q=${encodeURIComponent(search)}` : ""}`);
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      return (await res.json()) as MembersView & { enabled: boolean };
    },
    refetchInterval: 30_000,
    retry: 1,
  });
  return { view: query.data, isLoading: query.isLoading, isFetching: query.isFetching, error: query.error };
}
