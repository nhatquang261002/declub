"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useConnection } from "wagmi";
import { CHAIN_ID, CHOG_SWAP_ADDRESS } from "@/lib/config";
import { deriveNotifications, type AppNotification } from "@/lib/notifications";
import { useNow } from "./useNow";
import { useTrades } from "./useTrades";

// Notifications are derived from trade state (lib/notifications.ts). All that is stored is
// which ones this browser has already seen, and whether the user wants browser alerts.

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
  const { trades, isLoading } = useTrades({ limit: 200, enabled: !!address });

  const notifications = useMemo(
    () => deriveNotifications(trades, address, now),
    [trades, address, now],
  );

  // The snapshot is the raw string so React can compare it by value. "" = never opened.
  const raw = useSyncExternalStore(subscribe, () => readStore(address ? readKey(address) : null), () => "");
  const alertsRaw = useSyncExternalStore(subscribe, () => readStore(ALERTS_KEY), () => "");
  const read = useMemo(() => parseKeys(raw), [raw]);

  // First visit for this wallet: accepted trades from before now are history, not news.
  // Actionable items (direct offers, reclaims) stay unread.
  const seeded = raw !== "";
  useEffect(() => {
    if (!address || isLoading || seeded) return;
    const past = notifications.filter((n) => !n.actionable && n.kind === "filled").map((n) => n.key);
    writeStore(readKey(address), JSON.stringify(past));
  }, [address, isLoading, seeded, notifications]);

  const persist = useCallback(
    (keys: Iterable<string>) => {
      if (!address) return;
      writeStore(readKey(address), JSON.stringify([...new Set(keys)]));
    },
    [address],
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
