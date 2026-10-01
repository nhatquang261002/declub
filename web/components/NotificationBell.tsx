"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BellIcon, CheckIcon, ClockIcon, CrossIcon, InboxIcon, PauseIcon, SwapIcon } from "@/components/Icons";
import { usePopover } from "@/components/Popover";
import { useNotifications } from "@/hooks/useNotifications";
import type { AppNotification, NotificationKind } from "@/lib/notifications";

const KIND_LABEL: Record<NotificationKind, string> = {
  request: "For you",
  filled: "Accepted",
  expiring: "Ending soon",
  expired: "Expired",
  "intent-settled": "Settled",
  "intent-paused": "Paused",
  "intent-dropped": "Dropped",
};

// One icon and tint per kind: the colour says good news, needs you, or gone.
const KIND_LOOK: Record<NotificationKind, { icon: ReactNode; tone: string }> = {
  request: { icon: <InboxIcon />, tone: "bg-peach/20 text-peach" },
  filled: { icon: <CheckIcon />, tone: "bg-mint/15 text-mint" },
  expiring: { icon: <ClockIcon />, tone: "bg-white/10 text-white/80" },
  expired: { icon: <ClockIcon />, tone: "bg-danger/15 text-danger" },
  "intent-settled": { icon: <SwapIcon />, tone: "bg-mint/15 text-mint" },
  "intent-paused": { icon: <PauseIcon />, tone: "bg-warn/15 text-warn" },
  "intent-dropped": { icon: <CrossIcon />, tone: "bg-danger/15 text-danger" },
};

const MAX_SHOWN = 20;

type Alerts = ReturnType<typeof useNotifications>["alerts"];

export function NotificationBell() {
  const { account, notifications, unread, isRead, markRead, markAllRead, alerts } = useNotifications();
  // Nothing to say to a wallet-less visitor.
  if (!account) return null;
  return (
    <NotificationBellView
      notifications={notifications}
      unreadCount={unread.length}
      isRead={isRead}
      markRead={markRead}
      markAllRead={markAllRead}
      alerts={alerts}
    />
  );
}

/** The bell and its panel, split from the data so the layout can be built and checked on its own. */
export function NotificationBellView({
  notifications,
  unreadCount,
  isRead,
  markRead,
  markAllRead,
  alerts,
}: {
  notifications: AppNotification[];
  unreadCount: number;
  isRead: (key: string) => boolean;
  markRead: (key: string) => void;
  markAllRead: () => void;
  alerts: Alerts;
}) {
  const { open, setOpen, ref } = usePopover();
  const shown = notifications.slice(0, MAX_SHOWN);
  const fresh = shown.filter((n) => !isRead(n.key));
  const earlier = shown.filter((n) => isRead(n.key));

  const row = (n: AppNotification, isNew: boolean) => {
    const look = KIND_LOOK[n.kind];
    return (
      <li key={n.key}>
        <Link
          href={n.href}
          className="hdr-pop-item !items-start !py-3"
          onClick={() => {
            markRead(n.key);
            setOpen(false);
          }}
        >
          <span className={`hdr-pop-icon !size-9 !rounded-full ${look.tone}`}>{look.icon}</span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-baseline justify-between gap-2">
              <span className={`truncate text-sm ${isNew ? "font-bold text-white" : "font-semibold text-white/75"}`}>
                {n.title}
              </span>
              {isNew && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
            </span>
            <span className="text-xs leading-5 text-white/60">{n.body}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[0.65rem] font-bold tracking-wide text-white/45 uppercase">
              {KIND_LABEL[n.kind]}
              {n.actionable && <span className="rounded-full bg-peach/20 px-1.5 py-0.5 text-peach">Needs you</span>}
            </span>
          </span>
        </Link>
      </li>
    );
  };

  return (
    <div className="hdr-anchor" ref={ref}>
      <button
        type="button"
        className="hdr-btn hdr-btn-icon"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon className="size-[1.15rem]" />
        {unreadCount > 0 && <span className="hdr-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="hdr-pop" role="dialog" aria-label="Notifications" style={{ width: "min(24rem, calc(100vw - 2rem))" }}>
          <div className="hdr-pop-head !flex-row items-center justify-between !py-3">
            <span className="text-sm font-bold text-white">Notifications</span>
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-xs font-bold text-peach hover:bg-white/10 disabled:text-white/30 disabled:hover:bg-transparent"
              disabled={unreadCount === 0}
              onClick={markAllRead}
            >
              Mark all read
            </button>
          </div>

          {shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
              <span className="hdr-pop-icon !size-11 !rounded-full text-white/70"><BellIcon className="size-5" /></span>
              <p className="text-sm font-bold text-white">You&apos;re all caught up</p>
              <p className="text-xs leading-5 text-white/55">
                Direct offers, accepted deals, settled swaps and expiries show up here.
              </p>
            </div>
          ) : (
            <div className="max-h-[26rem] overflow-y-auto">
              {fresh.length > 0 && (
                <>
                  <p className="hdr-pop-label px-4 pt-3 pb-1">New</p>
                  <ul>{fresh.map((n) => row(n, true))}</ul>
                </>
              )}
              {earlier.length > 0 && (
                <>
                  <p className="hdr-pop-label px-4 pt-3 pb-1">Earlier</p>
                  <ul>{earlier.map((n) => row(n, false))}</ul>
                </>
              )}
            </div>
          )}

          {alerts.supported && (
            <>
              <div className="hdr-pop-sep" />
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex flex-col">
                  <span className="text-xs font-bold text-white">Browser alerts</span>
                  <span className="text-xs leading-5 text-white/55">
                    {alerts.denied
                      ? "Blocked in your browser settings."
                      : "While this tab is open in the background."}
                  </span>
                </span>
                {!alerts.denied && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={alerts.enabled}
                    aria-label="Browser alerts"
                    className="switch"
                    onClick={alerts.enabled ? alerts.disable : alerts.enable}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
