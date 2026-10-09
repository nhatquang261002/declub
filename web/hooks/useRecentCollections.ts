"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { parseRecent, readRecentRaw, RECENT_EVENT, saveRecent } from "@/lib/collections";
import { loadState, saveState } from "@/lib/userState";
import { subscribeStorage } from "./subscribeStorage";
import { useAccessToken } from "./useAccessToken";

// The collections a person used lately, for the NFT picker (ADR 0012). The browser's list is the
// working copy, so the picker never waits on a request. Signed in with Privy, it is also kept on
// the server and merged both ways, so a second device starts with the same shortlist.

const subscribe = subscribeStorage(RECENT_EVENT);

/** Recently used collections, newest first, and the server's copy folded in once per sign-in. */
export function useRecentCollections(): Address[] {
  const getToken = useAccessToken();
  const signedIn = !!getToken;
  const raw = useSyncExternalStore(subscribe, readRecentRaw, () => "[]");

  useEffect(() => {
    if (!getToken) return;
    let cancelled = false;
    (async () => {
      const remote = await loadState(getToken);
      if (cancelled || !remote.enabled) return;
      const mine = parseRecent(readRecentRaw());
      const theirs = parseRecent(JSON.stringify(remote.recents));
      // Whatever this browser had that the server didn't goes up; the server's list comes down.
      const merged = saveRecent([...theirs]);
      const missing = mine.filter((a) => !theirs.some((t) => t.toLowerCase() === a.toLowerCase()));
      if (missing.length > 0) await saveState(getToken, { recents: merged });
    })();
    return () => {
      cancelled = true;
    };
    // `getToken` changes identity with Privy's state; signing in or out is what should re-sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  return useMemo(() => parseRecent(raw), [raw]);
}

/** Notes a collection as used: saved here at once, and on the server when signed in. */
export function useRememberCollection() {
  const getToken = useAccessToken();
  return useCallback(
    (collection: Address) => {
      const next = saveRecent([collection]);
      if (getToken) void saveState(getToken, { recents: next });
    },
    [getToken],
  );
}
