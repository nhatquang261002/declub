"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useConnection } from "wagmi";
import { CHAIN_ID, CHOG_SWAP_ADDRESS } from "@/lib/config";
import {
  deriveIntentNotifications,
  deriveNotifications,
  NEWS_KINDS,
  sortNotifications,
  type AppNotification,
} from "@/lib/notifications";
import { loadState, saveState } from "@/lib/userState";
import { useAccessToken } from "./useAccessToken";
import { useNow } from "./useNow";
import { useDeals } from "./useDeals";
import { useIntents } from "./usePool";

// Notifications are derived from deal state (lib/notifications.ts). All that is stored is which
// ones have already been seen, and whether the user wants browser alerts.
//
// Seen markers live in this browser, and, signed in with Privy, on the server too (ADR 0012), so
// reading a notification on one device clears it on the next. They only ever grow, so the two
// copies are merged by union and neither can lose a mark. Whether to show browser alerts stays
// per browser: it is that browser's own permission.

const EVENT = "chogswap:notifications";
const scope = `${CHAIN_ID}:${CHOG_SWAP_ADDRESS}`;
const readKey = (account: string) => `chogswap:notifications:${scope}:${account.toLowerCase()}`;
const ALERTS_KEY = "chogswap:notification-alerts";

function readStore(key: string | null): string {
  if (!key) return "";
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Storage unavailable (private mode): everything just shows as unread next time.
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function parseKeys(raw: string): Set<string> {
  try {
    const list = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

const canAlert = () => typeof window !== "undefined" && "Notification" in window;

export function useNotifications() {
  const { address } = useConnection();
  const now = useNow(30_000);
  const { deals, isLoading: dealsLoading } = useDeals({ limit: 200, enabled: !!address });

  // Signed intents live in the pool, not on-chain. A pool that is down just adds nothing here.
  const intents = useIntents({ status: "all", maker: address, enabled: !!address });
  const isLoading = dealsLoading || intents.isLoading;

  const notifications = useMemo(
    () =>
      sortNotifications([
        ...deriveNotifications(deals, address, now),
        ...deriveIntentNotifications(intents.intents, address, now),
      ]),
    [deals, intents.intents, address, now],
  );

  // The snapshot is the raw string so React can compare it by value. "" = never opened.
  const raw = useSyncExternalStore(subscribe, () => readStore(address ? readKey(address) : null), () => "");
  const alertsRaw = useSyncExternalStore(subscribe, () => readStore(ALERTS_KEY), () => "");
  const read = useMemo(() => parseKeys(raw), [raw]);

  // The server's copy for this wallet, folded in once per sign-in. Until it has been, a wallet
  // that has never been opened here must not be seeded: the other device may already have done it.
  const getToken = useAccessToken();
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  });
  const signedIn = !!getToken;
  const [syncedFor, setSyncedFor] = useState<string>();
  const waiting = signedIn && !!address && syncedFor !== address.toLowerCase();

  useEffect(() => {
    const token = getTokenRef.current;
    if (!address || !token) return;
    let cancelled = false;
    (async () => {
      const remote = await loadState(token, address);
      if (cancelled) return;
      if (remote.enabled) {
        const stored = readStore(readKey(address));
        const mine = parseKeys(stored);
        const merged = new Set([...mine, ...remote.seen]);
        // Never opened here but opened elsewhere: take the server's list, even if it is empty.
        if (merged.size !== mine.size || (stored === "" && remote.initialized)) {
          writeStore(readKey(address), JSON.stringify([...merged]));
        }
        const theirs = new Set(remote.seen);
        const up = [...mine].filter((key) => !theirs.has(key));
        const needsInit = stored !== "" && !remote.initialized;
        if (up.length > 0 || needsInit) {
          void saveState(token, { account: address, seen: up, ...(needsInit ? { initialized: true as const } : {}) });
        }
      }
      setSyncedFor(address.toLowerCase());
    })();
    return () => {
      cancelled = true;
    };
  }, [address, signedIn]);

  const pushSeen = useCallback(
    (keys: string[], initialized?: true) => {
      const token = getTokenRef.current;
      if (token && address) void saveState(token, { account: address, seen: keys, initialized });
    },
    [address],
  );

  // First visit for this wallet: accepted deals and settled intents from before now are history,
  // not news. Actionable items (direct offers, reclaims, paused intents) stay unread.
  const seeded = raw !== "";
  useEffect(() => {
    if (!address || isLoading || seeded || waiting) return;
    const past = notifications.filter((n) => !n.actionable && NEWS_KINDS.includes(n.kind)).map((n) => n.key);
    writeStore(readKey(address), JSON.stringify(past));
    pushSeen(past, true);
  }, [address, isLoading, seeded, waiting, notifications, pushSeen]);

  const persist = useCallback(
    (keys: Iterable<string>) => {
      if (!address) return;
      const next = [...new Set(keys)];
      writeStore(readKey(address), JSON.stringify(next));
      pushSeen(next.filter((key) => !read.has(key)));
    },
    [address, read, pushSeen],
  );
  const markRead = useCallback((key: string) => persist([...read, key]), [persist, read]);
  const markAllRead = useCallback(
    () => persist([...read, ...notifications.map((n) => n.key)]),
    [persist, read, notifications],
  );

  const unread = useMemo(
    () => (seeded ? notifications.filter((n) => !read.has(n.key)) : []),
    [notifications, read, seeded],
  );

  // Browser alerts, only while a tab is open (no server can push to a closed one).
  const alertsEnabled =
    alertsRaw === "on" && canAlert() && Notification.permission === "granted";
  const announced = useRef<{ account?: string; keys: Set<string> }>({ keys: new Set() });
  useEffect(() => {
    if (!address || !seeded || isLoading) return;
    if (announced.current.account !== address) {
      // First pass for this wallet: what's already unread isn't news.
      announced.current = { account: address, keys: new Set(unread.map((n) => n.key)) };
      return;
    }
    const fresh = unread.filter((n) => !announced.current.keys.has(n.key));
    fresh.forEach((n) => announced.current.keys.add(n.key));
    if (!alertsEnabled || document.visibilityState !== "hidden") return;
    fresh.forEach((n) => alertBrowser(n));
  }, [address, seeded, isLoading, unread, alertsEnabled]);

  const enableAlerts = useCallback(async () => {
    if (!canAlert()) return;
    const permission =
      Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    writeStore(ALERTS_KEY, permission === "granted" ? "on" : "off");
  }, []);
  const disableAlerts = useCallback(() => writeStore(ALERTS_KEY, "off"), []);

  return {
    account: address,
    notifications,
    unread,
    isRead: (key: string) => read.has(key),
    markRead,
    markAllRead,
    alerts: {
      supported: canAlert(),
      denied: canAlert() && Notification.permission === "denied",
      enabled: alertsEnabled,
      enable: enableAlerts,
      disable: disableAlerts,
    },
  };
}

function alertBrowser(n: AppNotification) {
  try {
    const popup = new Notification(n.title, { body: n.body, tag: n.key });
    popup.onclick = () => {
      window.focus();
      window.location.assign(n.href);
    };
  } catch {
    // Some mobile browsers only allow notifications through a service worker.
  }
}
