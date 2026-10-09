"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { AvatarView } from "@/lib/avatars";
import { PRIVY_APP_ID } from "@/lib/config";
import type { Profile } from "@/lib/profiles";

// Profiles and avatars come from the Privy sign-in layer (ADR 0011, ADR 0028), so they are off
// without it. Every address on screen asks for its own, and the asks of one tick go out as a
// single request.

const BATCH_MS = 10;
const MAX_PER_REQUEST = 50;

/** What other traders see of a wallet. */
type WalletCard = { profile: Profile | null; avatar: AvatarView | null };

type Waiting = (card: WalletCard) => void;
let queue = new Map<string, Waiting[]>();
let timer: ReturnType<typeof setTimeout> | undefined;

function lookup(address: string): Promise<WalletCard> {
  return new Promise((resolve) => {
    const list = queue.get(address) ?? [];
    list.push(resolve);
    queue.set(address, list);
    timer ??= setTimeout(flush, BATCH_MS);
  });
}

async function flush() {
  const batch = queue;
  queue = new Map();
  timer = undefined;
  const addresses = [...batch.keys()];
  for (let i = 0; i < addresses.length; i += MAX_PER_REQUEST) {
    const chunk = addresses.slice(i, i + MAX_PER_REQUEST);
    let answer: { profiles?: Record<string, Profile>; avatars?: Record<string, AvatarView> } = {};
    try {
      const response = await fetch(`/api/profiles?addresses=${chunk.join(",")}`);
      if (response.ok) answer = await response.json();
    } catch {
      // Cosmetic: without an answer the address is shown as it always was.
    }
    for (const address of chunk) {
      const card = { profile: answer.profiles?.[address] ?? null, avatar: answer.avatars?.[address] ?? null };
      for (const resolve of batch.get(address) ?? []) resolve(card);
    }
  }
}

const cardKey = (address: string | undefined) => ["wallet-card", address?.toLowerCase()];

function useWalletCard(address: string | undefined): WalletCard | undefined {
  const key = address?.toLowerCase();
  const { data } = useQuery({
    queryKey: cardKey(key),
    queryFn: () => lookup(key!),
    enabled: !!PRIVY_APP_ID && !!key,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data;
}

/** The shared profile of a wallet, or `null` when its owner hasn't shared one (or hasn't loaded yet). */
export function useProfile(address: string | undefined): Profile | null {
  return useWalletCard(address)?.profile ?? null;
}

/** The avatar a wallet's owner picked, or `null` when they haven't (or it hasn't loaded yet). */
export function useAvatar(address: string | undefined): AvatarView | null {
  return useWalletCard(address)?.avatar ?? null;
}

/**
 * Shows a new avatar on the user's own wallets at once. The lookup is cached by the CDN for a
 * little while, so asking again right after a change could still answer with the old one.
 */
export function showOwnAvatar(queryClient: QueryClient, wallets: readonly string[], avatar: AvatarView | null) {
  for (const wallet of wallets) {
    queryClient.setQueryData<WalletCard>(cardKey(wallet), (card) => ({ profile: card?.profile ?? null, avatar }));
  }
}
