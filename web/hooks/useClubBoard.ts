"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/Toast";
import { useAccessToken } from "@/hooks/useAccessToken";
import { call, type ViewerRole } from "@/hooks/useClubMembership";
import { useSocialSign } from "@/hooks/useSocial";
import type { PostKind, PublicPost } from "@/lib/clubPosts";
import type { LensId } from "@/lib/lenses";
import { draftPost, postTypedData, signingTime } from "@/lib/social";
import type { LogEntry, Ban } from "@/lib/server/clubState";

// The board, the Club's page text and the staff tools (docs/09-clubs.md). Reads are public; a
// signed-in reader sends their token so they also see their own hidden posts and, as staff, all.

const REFRESH_MS = 30_000;

async function read<T>(path: string, getToken?: () => Promise<string | null>): Promise<T> {
  const token = await getToken?.();
  const res = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : undefined });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { message?: unknown } | null)?.message;
    throw new Error(typeof message === "string" ? message : `The server answered ${res.status}.`);
  }
  return body as T;
}

/**
 * The Club's board, through the reader's lens (ADR 0023). `as` is the reader's wallet, which the
 * `following` lens needs.
 */
export function useClubPosts(token: string, lens: LensId = "newest", as?: string) {
  const getToken = useAccessToken();
  const key = token.toLowerCase();
  const params = new URLSearchParams(lens === "newest" ? {} : { lens, ...(as ? { as } : {}) }).toString();
  const query = useQuery({
    queryKey: ["club-posts", key, !!getToken, lens, as?.toLowerCase()],
    queryFn: () => read<{ enabled: boolean; posts: PublicPost[]; role: ViewerRole | null }>(`/api/clubs/${token}/posts${params ? `?${params}` : ""}`, getToken),
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
  return { enabled: query.data?.enabled !== false, posts: query.data?.posts ?? [], isLoading: query.isLoading, error: query.error };
}

export type ClubPage = { enabled: boolean; description: string; links: string[]; holdersOnlyPosts: boolean; hasOwner: boolean };

/** The Club's description, links and "holders only" setting. */
export function useClubPage(token: string) {
  const query = useQuery({
    queryKey: ["club-profile", token.toLowerCase()],
    queryFn: () => read<ClubPage>(`/api/clubs/${token}/profile`),
    refetchInterval: REFRESH_MS * 4,
    retry: 1,
  });
  return query.data;
}

/** Every write to a Club's board or staff tools: signs the request, reports errors, refreshes what changed. */
export function useClubActions(token: string) {
  const getToken = useAccessToken();
  const queryClient = useQueryClient();
  const toast = useToast();
  const sign = useSocialSign();
  const key = token.toLowerCase();
  const base = `/api/clubs/${token}`;

  const refresh = (...names: string[]) => {
    for (const name of names) void queryClient.invalidateQueries({ queryKey: [name, key] });
  };
  const useAct = <V,>(run: (v: V) => Promise<unknown>, refreshes: string[], done?: string) =>
    useMutation({
      mutationFn: run,
      onSuccess: () => {
        refresh(...refreshes);
        if (done) toast.show({ tone: "success", title: done });
      },
      onError: (error) => toast.error(error),
    });
  const send = <T,>(method: string, path: string, body?: unknown) => call<T>(getToken!, method, `${base}${path}`, body);

  return {
    // A post is signed by the member's Club wallet before it's sent (ADR 0023).
    post: useAct(async (v: { kind: PostKind; text: string; link?: string; wallet?: string }) => {
      const draft = draftPost(token as `0x${string}`, v.kind, v.text, v.link ?? "", signingTime());
      if (!draft.ok) throw new Error(draft.reason === "bad_link" ? "Link a deal id or a signed-swap hash." : "Write something first, at most 280 characters.");
      const { signature } = await sign(postTypedData(draft.message), v.wallet);
      return send("POST", "/posts", { message: draft.message, signature });
    }, ["club-posts"]),
    remove: useAct((id: string) => send("DELETE", `/posts/${id}`), ["club-posts", "club-log"]),
    report: useAct((id: string) => send("POST", `/posts/${id}/report`), ["club-posts"], "Reported. Thank you."),
    hide: useAct((v: { id: string; hidden: boolean }) => send("POST", `/posts/${v.id}/hide`, { hidden: v.hidden }), ["club-posts", "club-log"]),
    pin: useAct((v: { id: string; pinned: boolean }) => send("POST", `/posts/${v.id}/pin`, { pinned: v.pinned }), ["club-posts", "club-log"]),
    ban: useAct((v: { wallet?: string; post?: string; everywhere?: boolean }) => send("POST", "/bans", v), ["club-posts", "club-bans", "club-log", "club-members", "clubs"], "Banned."),
    unban: useAct((v: { wallet: string; everywhere?: boolean }) => send("DELETE", "/bans", v), ["club-bans", "club-log"], "Ban lifted."),
    role: useAct((v: { wallet: string; role: "owner" | "moderator" | null }) => send("PUT", "/roles", v), ["club-members", "club-membership", "club-log", "club-posts"], "Done."),
    claim: useAct(() => send("POST", "/claim"), ["club-members", "club-membership", "club-profile", "club-log"], "You’re the Owner of this Club."),
    profile: useAct(
      (v: { description?: string; links?: string[]; holdersOnlyPosts?: boolean }) => send("PATCH", "/profile", v),
      ["club-profile", "club-log"],
      "Saved.",
    ),
  };
}

export type StaffView = { enabled: boolean; log: LogEntry[]; ownership: { claimed: string; onchain: string | null; changed: boolean } | null };

/** The moderation log and bans. Only staff are allowed to ask. */
export function useClubStaff(token: string, enabled: boolean) {
  const getToken = useAccessToken();
  const key = token.toLowerCase();
  const log = useQuery({
    queryKey: ["club-log", key],
    queryFn: () => call<StaffView>(getToken!, "GET", `/api/clubs/${token}/log`),
    enabled: enabled && !!getToken,
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
  const bans = useQuery({
    queryKey: ["club-bans", key],
    queryFn: () => call<{ club: Ban[]; everywhere: Ban[] }>(getToken!, "GET", `/api/clubs/${token}/bans`),
    enabled: enabled && !!getToken,
    retry: 1,
  });
  return { log: log.data?.log ?? [], ownership: log.data?.ownership ?? null, bans: bans.data, isLoading: log.isLoading };
}
