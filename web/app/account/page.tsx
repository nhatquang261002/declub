"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useConnection } from "wagmi";
import { XLogoIcon } from "@/components/Icons";
import { PageHeader } from "@/components/Page";
import { useToast } from "@/components/Toast";
import { KIND_LABEL, SOCIAL_KINDS, linkedRows, type AccountKind, type LinkedRow, type SocialKind } from "@/lib/accounts";
import { PRIVY_APP_ID } from "@/lib/config";
import { PROFILE_LABEL, type Profile } from "@/lib/profiles";
import { CopyAddress } from "@/components/CopyAddress";
import { RewardsClaim } from "@/components/RewardsClaim";
import { AvatarSection } from "./AvatarSection";

export default function AccountPage() {
  return (
    <>
      <PageHeader title="Account" />
      {PRIVY_APP_ID ? <Account /> : <NotConfigured />}
    </>
  );
}

function NotConfigured() {
  return (
    <div className="page-section px-6 py-10 text-center text-sm text-muted">
      Sign-in and linked accounts are off. Set <span className="font-mono">NEXT_PUBLIC_PRIVY_APP_ID</span> to
      turn them on; until then you connect an installed wallet.
    </div>
  );
}

function Account() {
  const privy = usePrivy();
  const connected = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { address: active } = useConnection();
  const toast = useToast();
  const [busy, setBusy] = useState<string>();

  if (!privy.ready) return <p className="text-sm text-muted">Loading…</p>;

  if (!privy.authenticated) {
    return (
      <div className="page-section flex flex-col items-center gap-4 px-6 py-12 text-center">
        <p className="text-muted">Sign in to manage the accounts linked to your wallet.</p>
        <button className="btn-primary" onClick={() => privy.login()}>Sign in</button>
      </div>
    );
  }

  const rows = linkedRows(privy.user);
  const socials = rows.filter((row) => row.kind !== "wallet");
  const wallets = rows.filter((row) => row.kind === "wallet");
  const hasKind = (kind: AccountKind) => rows.some((row) => row.kind === kind);

  const link: Record<SocialKind, () => void> = {
    email: privy.linkEmail,
    google: privy.linkGoogle,
    twitter: privy.linkTwitter,
    discord: privy.linkDiscord,
  };

  async function unlink(row: LinkedRow) {
    setBusy(row.id);
    try {
      switch (row.kind) {
        case "email": await privy.unlinkEmail(row.id); break;
        case "google": await privy.unlinkGoogle(row.id); break;
        case "twitter": await privy.unlinkTwitter(row.id); break;
        case "discord": await privy.unlinkDiscord(row.id); break;
        case "wallet": await privy.unlinkWallet(row.id); break;
      }
    } catch (error) {
      // Privy refuses to remove the last way to sign in; that comes back here as an error.
      toast.error(error);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <AvatarSection />

      <section className="page-section px-5 py-5">
        <h2 className="text-lg font-semibold">Your Club rewards</h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          What the Clubs you hold in paid this wallet from their swaps’ fees. Rewards go to your Club wallet, the one each
          Club’s Members list shows; switch to it below to see its rewards here.
        </p>
        <RewardsClaim account={active} />
      </section>

      <section className="page-section px-5 py-5">
        <h2 className="text-lg font-semibold">Linked accounts</h2>
        <p className="mt-1 text-sm text-muted">
          Link a Google, X or Discord account to your wallet to sign in with it later, without opening
          your wallet first. They are for signing in and recovery. Nothing is shown to other traders unless you turn it on below.
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          {socials.length === 0 && <li className="text-sm text-muted">Nothing linked yet.</li>}
          {socials.map((row) => (
            <Row key={`${row.kind}:${row.id}`} row={row} busy={busy === row.id} onUnlink={() => unlink(row)} />
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          {SOCIAL_KINDS.filter((kind) => !hasKind(kind)).map((kind) => (
            <button key={kind} className="btn-secondary" onClick={() => link[kind]()}>
              Link {KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      </section>

      <section className="page-section px-5 py-5">
        <h2 className="text-lg font-semibold">Wallets</h2>
        <ul className="mt-4 flex flex-col gap-2">
          {wallets.length === 0 && (
            <li className="text-sm text-muted">No wallet linked yet. Link the one you trade with.</li>
          )}
          {wallets.map((row) => {
            const isActive = !!active && row.id.toLowerCase() === active.toLowerCase();
            const live = connected.wallets.find((w) => w.address.toLowerCase() === row.id.toLowerCase());
            return (
              <Row
                key={row.id}
                row={row}
                busy={busy === row.id}
                onUnlink={() => unlink(row)}
                badge={isActive ? "In use" : undefined}
                extra={
                  isActive ? undefined : live ? (
                    <button className="btn-secondary" onClick={() => setActiveWallet(live).catch(toast.error)}>
                      Use this wallet
                    </button>
                  ) : (
                    <button className="btn-secondary" onClick={() => privy.connectWallet()}>Connect</button>
                  )
                }
              />
            );
          })}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => privy.linkWallet()}>
            {wallets.length ? "Link another wallet" : "Link a wallet"}
          </button>
          {wallets.some((row) => row.embedded) && (
            <button className="btn-secondary" onClick={() => privy.exportWallet().catch(toast.error)}>
              Export embedded wallet key
            </button>
          )}
        </div>
        {wallets.some((row) => row.embedded) && (
          <p className="mt-3 text-xs text-muted">
            The embedded wallet is made for you at sign-in and only you can use it. Export its key
            somewhere safe if it will hold anything you care about: anyone with the key controls it.
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          A wallet can be linked to one account only. Unlinking removes it from sign-in, not from the
          wallet itself.
        </p>
      </section>

      <ShareProfile />
    </div>
  );
}


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
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  return { state, busy, share: () => change("PUT"), stop: () => change("DELETE") };
}

function ShareProfile() {
  const { state, busy, share, stop } = useSharedProfile();
  if (!state?.enabled) return null;

  const { shared, profile, available } = state;
  const label = (p: Profile) => (p.provider === "twitter" ? `@${p.handle}` : p.handle);

  return (
    <section className="page-section px-5 py-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        Show my profile to other traders
        {shared && <span className="rounded-full bg-mint/15 px-2 py-0.5 text-[0.65rem] font-normal text-mint">On</span>}
      </h2>
      <p className="mt-1 text-sm text-muted">
        Next to your wallet on deals, others see the X or Discord account you linked here, so they know who they are
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
            {busy ? "Working…" : "Show my profile"}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">
          Link an X account above to turn this on. Discord works too; Google and email are never shown.
        </p>
      )}
    </section>
  );
}

function Row({
  row,
  busy,
  onUnlink,
  badge,
  extra,
}: {
  row: LinkedRow;
  busy: boolean;
  onUnlink: () => void;
  badge?: string;
  extra?: ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-line/70 px-3 py-2.5">
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          {row.embedded ? "Embedded wallet" : KIND_LABEL[row.kind]}
          {badge && <span className="rounded-full bg-mint/15 px-2 py-0.5 text-[0.65rem] text-mint">{badge}</span>}
        </span>
        <span className="truncate font-mono text-sm">
          {row.kind === "wallet" ? <CopyAddress address={row.label} /> : row.label}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {extra}
        {!row.embedded && (
          <button className="btn-secondary" disabled={busy} onClick={onUnlink}>
            {busy ? "Unlinking…" : "Unlink"}
          </button>
        )}
      </span>
    </li>
  );
}
