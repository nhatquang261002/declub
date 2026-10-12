"use client";

import { useEffect, useRef } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useConnection } from "wagmi";
import { useToast } from "@/components/Toast";
import { profileCall } from "@/components/profile/api";
import { useAccessToken } from "@/hooks/useAccessToken";
import { read } from "@/hooks/useClubBoard";
import { timelineView, type TimelinePage } from "@/hooks/useTimeline";
import { call } from "@/hooks/useClubMembership";
import type { About, WalletClub, WalletProfile } from "@/lib/about";
import { linkedRows } from "@/lib/accounts";
import { PRIVY_APP_ID } from "@/lib/config";
import type { FollowMessage } from "@/lib/social";
import { TIMELINE_PAGE } from "@/lib/timeline";

// The profile page (ADR 0042): what a wallet's owner shows about themselves, the Clubs it is listed in,
// the Board posts it wrote and the wallets it follows. All of it is public and read by wallet address.

const profileKey = (address: string | undefined) => ["wallet-profile", address?.toLowerCase()];

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return (await res.json()) as T;
}

/**
 * The handle, avatar, name and bio shown for a wallet. A visitor's answer may come from the CDN's
 * copy a few seconds old; the owner's own page asks for a fresh one, so what they just saved shows.
 */
export function useWalletProfile(address: string | undefined, fresh: boolean) {
  return useQuery({
    queryKey: [...profileKey(address), fresh],
    queryFn: () => getJson<WalletProfile>(`/api/wallets/${address}/profile${fresh ? "?fresh=1" : ""}`),
    enabled: !!address,
    retry: 1,
  });
}

/** The Clubs whose Members list shows a wallet. The owner's own page asks for a fresh answer, as for the profile. */
export function useWalletClubs(address: string | undefined, fresh: boolean) {
  return useQuery({
    queryKey: ["wallet-clubs", address?.toLowerCase(), fresh],
    queryFn: () => getJson<{ enabled: boolean; clubs: WalletClub[] }>(`/api/wallets/${address}/clubs${fresh ? "?fresh=1" : ""}`),
    enabled: !!address,
    retry: 1,
  });
}

/**
 * A wallet's Board posts, a page at a time, as the timeline's cards want them (ADR 0042). The key
 * starts with "timeline" so a like or reply made on one of these cards updates it the way it does
 * the timeline's own lists.
 */
export function useWalletBoard(address: string | undefined) {
  const getToken = useAccessToken();
  const query = useInfiniteQuery({
    queryKey: ["timeline", "wallet", address?.toLowerCase(), !!getToken],
    initialPageParam: null as string | null,
    enabled: !!address,
    queryFn: ({ pageParam }) =>
      read<TimelinePage>(
        `/api/wallets/${address}/board?${new URLSearchParams({ limit: String(TIMELINE_PAGE), ...(pageParam ? { before: pageParam } : {}) })}`,
        getToken,
      ),
    getNextPageParam: (last) => last.next ?? undefined,
    retry: 1,
  });
  return timelineView(query);
}

type GraphView = { enabled: boolean; follows: { message: FollowMessage }[]; followers: number };

/** Who a wallet follows (signed follows that are still on) and how many follow it. */
export function useFollowGraph(address: string | undefined) {
  const query = useQuery({
    queryKey: ["follows", address?.toLowerCase()],
    queryFn: () => getJson<GraphView>(`/api/wallets/${address}/follows`),
    enabled: !!address,
    retry: 1,
  });
  const following = (query.data?.follows ?? []).filter((f) => f.message.following).map((f) => f.message.target.toLowerCase());
  return { following, followers: query.data?.followers ?? 0, isLoading: query.isLoading, error: query.error };
}

const usePrivyWallets = (): string[] => {
  const { user } = usePrivy();
  return linkedRows(user)
    .filter((row) => row.kind === "wallet")
    .map((row) => row.id.toLowerCase());
};
const useNoWallets = (): string[] => [];
/** PRIVY_APP_ID is fixed at build time, so the same hook runs for the life of the app (see `useAccessToken`). */
export const useLinkedWallets: () => string[] = PRIVY_APP_ID ? usePrivyWallets : useNoWallets;

/** The wallets the viewer can say are theirs: the ones linked to their sign-in, and the one connected now. */
export function useMyWallets(): ReadonlySet<string> {
  const linked = useLinkedWallets();
  const { address } = useConnection();
  return new Set([...linked, ...(address ? [address.toLowerCase()] : [])]);
}

/**
 * Copies the owner's name, bio, avatar and shared handle onto a wallet they just linked. The server
 * keeps one row per wallet and the webhook does this too, but only where it is registered; each of
 * these reads catches up on its own, so a newly linked wallet's profile isn't blank until the
 * owner opens the edit panel. Runs once per set of linked wallets.
 */
export function useCatchUpLinkedWallets(enabled: boolean) {
  const getToken = useAccessToken();
  const queryClient = useQueryClient();
  const linked = useLinkedWallets().slice().sort().join(",");
  const done = useRef("");

  useEffect(() => {
    if (!enabled || !getToken || !linked || done.current === linked) return;
    done.current = linked;
    const call = <T extends { message?: string }>(path: string, method: "GET" | "PUT", body?: unknown) =>
      profileCall<T>(getToken, path, "Couldn't sync your profile.", method, body);
    (async () => {
      await Promise.all([call("/api/about", "GET"), call("/api/avatar", "GET"), call("/api/profile", "PUT", { refresh: true })]);
      await queryClient.invalidateQueries({ queryKey: ["wallet-profile"] });
    })().catch(() => {
      // Cosmetic: the next visit tries again.
      done.current = "";
    });
  }, [enabled, getToken, linked, queryClient]);
}

/** The signed-in user's own name and bio, read and changed through `/api/about`. */
export function useOwnAbout() {
  const getToken = useAccessToken();
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({
    queryKey: ["own-about", !!getToken],
    queryFn: () => call<{ enabled: boolean; about?: About }>(getToken!, "GET", "/api/about"),
    enabled: !!getToken,
    retry: 1,
  });

  const save = useMutation({
    mutationFn: (about: About) => call<{ enabled: boolean; about: About }>(getToken!, "PUT", "/api/about", about),
    onSuccess: (answer) => {
      queryClient.setQueryData(["own-about", !!getToken], answer);
      void queryClient.invalidateQueries({ queryKey: ["wallet-profile"] });
      toast.show({ tone: "success", title: "Profile saved." });
    },
    onError: (error) => toast.error(error),
  });

  return {
    /** Signed in, and the server keeps profiles. */
    can: !!getToken && query.data?.enabled !== false,
    about: query.data?.about,
    isLoading: query.isLoading,
    saving: save.isPending,
    save: (about: About) => save.mutateAsync(about),
  };
}
