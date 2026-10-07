"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { XLogoIcon } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { PROFILE_LABEL, type Profile } from "@/lib/profiles";

type ShareState =
  | { enabled: false }
  | { enabled: true; shared: boolean; profile?: Profile; available?: Profile; stale: boolean };

/**
 * The signed-in user's shared profile (ADR 0011). The server reads their linked accounts from Privy
 * itself; the browser only sends its access token and says "share" or "stop".
 */
function useSharedProfile() {
  const { getAccessToken, user } = usePrivy();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ShareState>();
  const [busy, setBusy] = useState(false);

  const call = useCallback(
    async (method: "GET" | "PUT" | "DELETE", body?: unknown) => {
      const token = await getAccessToken();
      const response = await fetch("/api/profile", {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await response.json()) as ShareState & { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Couldn't update your profile.");
      return data;
    },
    [getAccessToken],
  );

  // Re-read when the linked accounts change; when a shared profile has gone stale (a renamed X
  // account, an unlinked wallet), bring it up to date without asking again.
  const linkedKey = user?.linkedAccounts.map((a) => a.type).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let next = await call("GET");
        if (next.enabled && next.shared && next.stale) next = await call("PUT", { refresh: true }).then(() => call("GET"));
        if (!cancelled) setState(next);
      } catch {
        // Profiles are optional: if the server can't say, the section stays hidden.
        if (!cancelled) setState({ enabled: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [call, linkedKey]);

  async function change(method: "PUT" | "DELETE") {
    setBusy(true);
    try {
      await call(method);
      setState(await call("GET"));
      // The handle shows beside the wallet everywhere, so what was cached for it is out of date.
      void queryClient.invalidateQueries({ queryKey: ["wallet-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet-card"] });
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  return { state, busy, share: () => change("PUT"), stop: () => change("DELETE") };
}

export function ShareHandle() {
  const { state, busy, share, stop } = useSharedProfile();
  if (!state?.enabled) return null;

  const { shared, profile, available } = state;
  const label = (p: Profile) => (p.provider === "twitter" ? `@${p.handle}` : p.handle);

  return (
    <section className="page-section px-5 py-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        Show my X or Discord handle
        {shared && <span className="rounded-full bg-mint/15 px-2 py-0.5 text-[0.65rem] font-normal text-mint">On</span>}
      </h2>
      <p className="mt-1 text-sm text-muted">
        Next to your wallet on deals, others see the X or Discord account you linked, so they know who they are
        trading with, and signed-in traders can find your wallet by that handle to make you a private deal. It only
        shows that the account and the wallet belong to the same person, not that either is trustworthy. Off until you
        turn it on, and you can turn it off at any time.
      </p>
      {shared && profile ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/70 px-3 py-2.5">
          <span className="flex items-center gap-2 text-sm">
            {profile.provider === "twitter" && <XLogoIcon className="size-3.5" />}
            <span className="font-semibold">{label(profile)}</span>
            <span className="text-xs text-muted">on {PROFILE_LABEL[profile.provider]}</span>
          </span>
          <button className="btn-secondary" disabled={busy} onClick={stop}>
            {busy ? "Working…" : "Stop showing"}
          </button>
        </div>
      ) : available ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted">
            Would show <span className="font-semibold text-[#111318]">{label(available)}</span> ({PROFILE_LABEL[available.provider]}) beside
            every wallet linked to this sign-in.
          </span>
          <button className="btn-primary" disabled={busy} onClick={share}>
            {busy ? "Working…" : "Show my handle"}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">
          Link an X account in your <Link href="/settings" className="font-bold underline">account settings</Link> to turn this on. Discord works too; Google and email are never shown.
        </p>
      )}
    </section>
  );
}
