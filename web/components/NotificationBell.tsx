"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useNotifications } from "@/hooks/useNotifications";
import type { NotificationKind } from "@/lib/notifications";

const KIND_LABEL: Record<NotificationKind, string> = {
  request: "For you",
  filled: "Accepted",
  expiring: "Ending soon",
  expired: "Expired",
  "intent-settled": "Settled",
  "intent-paused": "Paused",
  "intent-dropped": "Dropped",
};

const KIND_TONE: Record<NotificationKind, string> = {
  request: "bg-accent/15 text-accent",
  filled: "bg-mint/10 text-mint",
  expiring: "bg-white/10 text-white/80",
  expired: "bg-danger/15 text-danger",
  "intent-settled": "bg-mint/10 text-mint",
  "intent-paused": "bg-warn/15 text-warn",
  "intent-dropped": "bg-danger/15 text-danger",
};

const MAX_SHOWN = 20;

export function NotificationBell() {
  const { account, notifications, unread, isRead, markRead, markAllRead, alerts } = useNotifications();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
      } else if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  // Nothing to say to a wallet-less visitor.
  if (!account) return null;

  const shown = notifications.slice(0, MAX_SHOWN);

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        className="wallet-control relative"
        aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon />
        {unread.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[0.65rem] leading-5 font-black text-white">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>

      {open && (
        <div className="wallet-menu" role="dialog" aria-label="Notifications" style={{ width: "min(24rem, calc(100vw - 2rem))" }}>
          <div className="wallet-menu-account flex-row items-center justify-between">
            <span className="wallet-menu-label !mb-0">Notifications</span>
            <button
              type="button"
              className="text-xs font-semibold text-accent disabled:text-white/30"
              disabled={unread.length === 0}
              onClick={markAllRead}
            >
              Mark all read
            </button>
          </div>

          {shown.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-white/60">
              You&apos;re all caught up. Direct offers, accepted deals, settled intents and expiries show up here.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {shown.map((n) => {
                const isNew = !isRead(n.key);
                return (
                  <li key={n.key} className="border-b border-white/5 last:border-b-0">
                    <Link
                      href={n.href}
                      className="wallet-menu-item !items-start"
                      onClick={() => {
                        markRead(n.key);
                        setOpen(false);
                      }}
                    >
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[0.65rem] font-bold ${KIND_TONE[n.kind]}`}>
                            {KIND_LABEL[n.kind]}
                          </span>
                          <span className={`truncate text-sm ${isNew ? "font-bold text-white" : "text-white/70"}`}>
                            {n.title}
                          </span>
                        </span>
                        <span className="text-xs leading-5 text-white/60">{n.body}</span>
                      </span>
                      {isNew && <span className="wallet-status-dot mt-1.5 shrink-0" aria-label="Unread" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {alerts.supported && (
            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
              <span className="text-xs leading-5 text-white/60">
                {alerts.denied
                  ? "Browser alerts are blocked in your browser settings."
                  : "Browser alerts while this tab is open in the background."}
              </span>
              {!alerts.denied && (
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-white/20 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/10"
                  onClick={alerts.enabled ? alerts.disable : alerts.enable}
                >
                  {alerts.enabled ? "Turn off" : "Turn on"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}
