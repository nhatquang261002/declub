"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { useAccessToken } from "@/hooks/useAccessToken";
import { call, type ViewerRole } from "@/hooks/useClubMembership";
import { useSocialSign, type SocialStage } from "@/hooks/useSocial";
import type { PostKind, PublicPost } from "@/lib/clubPosts";
import type { LensId } from "@/lib/lenses";
import { draftPost, draftReply, postTypedData, replyTypedData, signingTime } from "@/lib/social";
import type { LogEntry, Ban } from "@/lib/server/clubState";
import type { ReportedItem } from "@/lib/server/board";
import type { XShareVerdict } from "@/lib/server/xPosts";

// The board, the Club's page text and the staff tools (docs/09-clubs.md). Reads are public; a
// signed-in reader sends their token so they also see their own hidden posts and, as staff, all.

const REFRESH_MS = 30_000;
/** Posts shown at first and added by each "Show more". */
const POSTS_PAGE = 20;

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
  const query = useInfiniteQuery({
    queryKey: ["club-posts", key, !!getToken, lens, as?.toLowerCase()],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(POSTS_PAGE), offset: String(pageParam), ...(lens === "newest" ? {} : { lens, ...(as ? { as } : {}) }) });
      return read<{ enabled: boolean; posts: PublicPost[]; role: ViewerRole | null; total: number }>(`/api/clubs/${token}/posts?${params}`, getToken);
    },
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, page) => n + page.posts.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
  const pages = query.data?.pages ?? [];
  // A post that arrives between two pages shifts the next one by a row; show each post once.
  const posts = [...new Map(pages.flatMap((page) => page.posts).map((post) => [post.id, post])).values()];
  return {
    enabled: pages[0]?.enabled !== false,
    posts,
    total: pages[0]?.total ?? 0,
    hasMore: query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
    isLoading: query.isLoading,
    error: query.error,
  };
}

/** A post's replies (ADR 0032), oldest first; read only while the thread is open. */
export function useClubReplies(token: string, postId: string, enabled: boolean) {
  const getToken = useAccessToken();
  const query = useQuery({
    queryKey: ["club-replies", token.toLowerCase(), postId, !!getToken],
    queryFn: () => read<{ enabled: boolean; replies: PublicPost[] }>(`/api/clubs/${token}/posts/${postId}/replies`, getToken),
    enabled,
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
  return { replies: query.data?.replies ?? [], isLoading: query.isLoading, error: query.error };
}

/** The Club's X signals (ADR 0024): its linked project accounts, its tags, and "what counts" in words. */
export type ClubX = { accounts: { handle: string; proof: string; linkedAt: number }[]; tags: string[]; hint: string };

/** Whether the Club's memecoin earns the Holder badge (ADR 0026): `min` in base units; `set` once the Owner chose. */
export type ClubCoin = { token: string; symbol: string; on: boolean; min: string; set: boolean };

export type ClubPage = { enabled: boolean; description: string; links: string[]; holdersOnlyPosts: boolean; hasOwner: boolean; x: ClubX; coin: ClubCoin | null };

/** Why a member's own X post didn't count, in words. */
const NOT_COUNTED: Record<NonNullable<XShareVerdict["reason"]>, string> = {
  not_own: "",
  not_holder: "Only Holders’ X posts count toward the Club’s Momentum.",
  too_old: "Only X posts from the last 48 hours count.",
  no_signal: "It doesn’t link the Club, mention its X account or use its tags.",
  daily_limit: "One X post a day counts per Club; this one is shown, not counted.",
  already_counted: "That X post has already counted.",
};

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
  // Posts and replies are signed first, so say whether the wallet or the server is being waited on.
  const [postStage, setPostStage] = useState<SocialStage>();
  const [replyStage, setReplyStage] = useState<SocialStage>();

  const refresh = (...names: string[]) => {
    for (const name of names) void queryClient.invalidateQueries({ queryKey: [name, key] });
  };
  const useAct = <V, R = unknown>(run: (v: V) => Promise<R>, refreshes: string[], done?: string) =>
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
    postStage,
    replyStage,
    // A post is signed by the member's Club wallet before it's sent (ADR 0023).
    post: useAct(async (v: { kind: PostKind; text: string; link?: string; wallet?: string }) => {
      const draft = draftPost(token as `0x${string}`, v.kind, v.text, v.link ?? "", signingTime());
      if (!draft.ok) {
        throw new Error(
          draft.reason !== "bad_link" ? "Write something first, at most 280 characters." : v.kind === "note" ? "Paste the link of an X post." : "Link a deal id or a signed-swap hash.",
        );
      }
      let result: { xShare?: XShareVerdict };
      try {
        setPostStage("signing");
        const { signature } = await sign(postTypedData(draft.message), v.wallet);
        setPostStage("sending");
        result = await send<{ xShare?: XShareVerdict }>("POST", "/posts", { message: draft.message, signature });
      } finally {
        setPostStage(undefined);
      }
      // Tell the author whether their own X post counted (ADR 0024); someone else's is just a card.
      const share = result.xShare;
      if (share?.counted) {
        toast.show({
          tone: "success",
          title: "Your X post counts for the Club",
          message: share.counted === "weak" ? "It only matched a tag, so it counts half. Linking the Club or its X account counts in full." : "It adds to your Momentum, and to your Holder bonus if you hold the Club’s NFT.",
        });
      } else if (share?.own && share.reason && NOT_COUNTED[share.reason]) {
        toast.show({ tone: "info", title: "Posted, not counted", message: NOT_COUNTED[share.reason] });
      }
      return result;
    }, ["club-posts", "clubs", "club-members"]),
    // A reply is signed too, with its own type (ADR 0032).
    reply: useAct(async (v: { parent: string; text: string; wallet?: string }) => {
      const draft = draftReply(token as `0x${string}`, v.parent, v.text, signingTime());
      if (!draft.ok) throw new Error("Write something first, at most 280 characters.");
      try {
        setReplyStage("signing");
        const { signature } = await sign(replyTypedData(draft.message), v.wallet);
        setReplyStage("sending");
        return await send("POST", `/posts/${v.parent}/replies`, { message: draft.message, signature });
      } finally {
        setReplyStage(undefined);
      }
    }, ["club-replies", "club-posts"]),
    remove: useAct((id: string) => send("DELETE", `/posts/${id}`), ["club-posts", "club-replies", "club-log", "club-reported"]),
    report: useAct((id: string) => send("POST", `/posts/${id}/report`), ["club-posts", "club-replies", "club-reported"], "Reported. Thank you."),
    like: useAct((v: { id: string; like: boolean }) => send(v.like ? "POST" : "DELETE", `/posts/${v.id}/like`), ["club-posts", "club-replies"]),
    hide: useAct((v: { id: string; hidden: boolean }) => send("POST", `/posts/${v.id}/hide`, { hidden: v.hidden }), ["club-posts", "club-replies", "club-log", "club-reported"]),
    pin: useAct((v: { id: string; pinned: boolean }) => send("POST", `/posts/${v.id}/pin`, { pinned: v.pinned }), ["club-posts", "club-log"]),
    ban: useAct((v: { wallet?: string; post?: string; everywhere?: boolean }) => send("POST", "/bans", v), ["club-posts", "club-bans", "club-log", "club-members", "clubs"], "Banned."),
    unban: useAct((v: { wallet: string; everywhere?: boolean }) => send("DELETE", "/bans", v), ["club-bans", "club-log"], "Ban lifted."),
    role: useAct((v: { wallet: string; role: "owner" | "moderator" | null }) => send("PUT", "/roles", v), ["club-members", "club-membership", "club-log", "club-posts"], "Done."),
    claim: useAct(() => send("POST", "/claim"), ["club-members", "club-membership", "club-profile", "club-log"], "You’re the Owner of this Club."),
    profile: useAct(
      (v: { description?: string; links?: string[]; holdersOnlyPosts?: boolean; xTags?: string[]; coinHolders?: { on: boolean; min?: string } }) =>
        send("PATCH", "/profile", v),
      ["club-profile", "club-log", "club-members"],
      "Saved.",
    ),
    // Linking the project's X account (ADR 0024): a code to post from it, then the post's link.
    xStart: useAct((handle: string) => send<{ handle: string; code: string; text: string; until: number }>("POST", "/x", { action: "start", handle }), []),
    xVerify: useAct((v: { handle: string; url: string }) => send("POST", "/x", { action: "verify", ...v }), ["club-profile", "club-log"], "X account linked."),
    xUnlink: useAct((handle: string) => send("DELETE", "/x", { handle }), ["club-profile", "club-log"], "X account unlinked."),
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
  // Posts and replies members reported, for the Manage tab (ADR 0040: a report alone hides nothing).
  const reported = useQuery({
    queryKey: ["club-reported", key],
    queryFn: () => call<{ enabled: boolean; reported: ReportedItem[] }>(getToken!, "GET", `/api/clubs/${token}/reported`),
    enabled: enabled && !!getToken,
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
  return { log: log.data?.log ?? [], ownership: log.data?.ownership ?? null, bans: bans.data, reported: reported.data?.reported ?? [], isLoading: log.isLoading };
}
