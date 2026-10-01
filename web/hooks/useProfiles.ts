"use client";

import { useQuery } from "@tanstack/react-query";
import { PRIVY_APP_ID } from "@/lib/config";
import type { Profile } from "@/lib/profiles";

// Profiles come from the Privy sign-in layer (ADR 0011), so they are off without it. Every address
// on screen asks for its own profile, and the asks of one tick go out as a single request.

const BATCH_MS = 10;
const MAX_PER_REQUEST = 50;

type Waiting = (profile: Profile | null) => void;
let queue = new Map<string, Waiting[]>();
let timer: ReturnType<typeof setTimeout> | undefined;

function lookup(address: string): Promise<Profile | null> {
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
    let profiles: Record<string, Profile> = {};
    try {
      const response = await fetch(`/api/profiles?addresses=${chunk.join(",")}`);
      if (response.ok) profiles = ((await response.json()) as { profiles?: Record<string, Profile> }).profiles ?? {};
    } catch {
      // Cosmetic: without an answer the address is shown as it always was.
    }
    for (const address of chunk) {
      const profile = profiles[address] ?? null;
      for (const resolve of batch.get(address) ?? []) resolve(profile);
    }
  }
}

/** The shared profile of a wallet, or `null` when its owner hasn't shared one (or hasn't loaded yet). */
export function useProfile(address: string | undefined): Profile | null {
  const key = address?.toLowerCase();
  const { data } = useQuery({
    queryKey: ["profile", key],
    queryFn: () => lookup(key!),
    enabled: !!PRIVY_APP_ID && !!key,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data ?? null;
}
