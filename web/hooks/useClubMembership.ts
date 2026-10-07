"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/Toast";
import { useAccessToken, type GetAccessToken } from "@/hooks/useAccessToken";
import { MEMBERS_PAGE, type MemberSort, type MembersView } from "@/lib/members";

// Membership is per user, so it needs the Privy access token (ADR 0012's pattern). Without sign-in
// or without a server that keeps it, a Club is read-only, and these hooks say so rather than fail.

export async function call<T>(getToken: GetAccessToken, method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error("Sign in again to continue.");
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { message?: unknown } | null)?.message;
    throw new Error(typeof message === "string" ? message : `The server answered ${res.status}.`);
  }
  return data as T;
}

export type ViewerRole = "admin" | "owner" | "moderator" | "member";
type Membership = { enabled: boolean; member?: boolean; wallet?: string; holder?: boolean; joinedAt?: number; role?: ViewerRole };

/** The signed-in user's membership of one Club, with join and leave. */
export function useClubMembership(token: string) {
  const getToken = useAccessToken();
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ["club-membership", token.toLowerCase()];
  const path = `/api/clubs/${token}/membership`;

  const query = useQuery({
    queryKey: key,
    queryFn: () => call<Membership>(getToken!, "GET", path),
    enabled: !!getToken,
    staleTime: 60_000,
    retry: 1,
  });

  const useChange = (method: "POST" | "DELETE") =>
    useMutation({
      mutationFn: () => call<Membership>(getToken!, method, path),
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
