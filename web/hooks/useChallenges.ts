"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/Toast";
import { useAccessToken } from "@/hooks/useAccessToken";
import { read } from "@/hooks/useClubBoard";
import { call } from "@/hooks/useClubMembership";
import type { ChallengeInput, PublicChallenge } from "@/lib/challenges";

const REFRESH_MS = 30_000;

/** The Club's challenges with their entries (ADR 0045). Public; a signed-in reader also sees which entries are theirs and which they liked. */
export function useChallenges(token: string) {
  const getToken = useAccessToken();
  const query = useQuery({
    queryKey: ["club-challenges", token.toLowerCase(), !!getToken],
    queryFn: () => read<{ enabled: boolean; challenges: PublicChallenge[] }>(`/api/clubs/${token}/challenges`, getToken),
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
  return { enabled: query.data?.enabled !== false, challenges: query.data?.challenges ?? [], isLoading: query.isLoading, error: query.error };
}

/** Starting, entering, picking and cancelling. Each refreshes the list, the log and the standings. */
export function useChallengeActions(token: string) {
  const getToken = useAccessToken();
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = token.toLowerCase();
  const send = <T,>(path: string, body: unknown) => call<T>(getToken!, "POST", `/api/clubs/${token}/challenges${path}`, body);
  const useAct = <V, R = unknown>(run: (v: V) => Promise<R>, done?: string) =>
    useMutation({
      mutationFn: run,
      onSuccess: () => {
        for (const name of ["club-challenges", "club-log", "club-standings", "club-posts"]) void queryClient.invalidateQueries({ queryKey: [name, key] });
        if (done) toast.show({ tone: "success", title: done });
      },
      onError: (error) => toast.error(error),
    });
  return {
    create: useAct((v: ChallengeInput) => send<{ id: string }>("", v), "Challenge started."),
    enter: useAct((v: { id: string; post: string }) => send(`/${v.id}`, { action: "enter", post: v.post }), "You’re in."),
    withdraw: useAct((id: string) => send(`/${id}`, { action: "withdraw" }), "Entry withdrawn."),
    pick: useAct((v: { id: string; posts: string[] }) => send(`/${v.id}`, { action: "pick", posts: v.posts }), "Winners picked. Their points count this epoch."),
    cancel: useAct((id: string) => send(`/${id}`, { action: "cancel" }), "Challenge cancelled."),
  };
}
