"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useConnection } from "wagmi";
import { PageHeader } from "@/components/Page";
import { useToast } from "@/components/Toast";
import { KIND_LABEL, SOCIAL_KINDS, linkedRows, type AccountKind, type LinkedRow } from "@/lib/accounts";
import { PRIVY_APP_ID } from "@/lib/config";
import { CopyAddress } from "@/components/CopyAddress";
import { RewardsClaim } from "@/components/RewardsClaim";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Account settings" />
      {PRIVY_APP_ID ? <Account /> : <NotConfigured />}
    </>
  );
}

function NotConfigured() {
  return (
    <div className="page-section px-6 py-10 text-center text-sm text-muted">
      Sign-in and linked accounts aren&apos;t available here. Connect an installed wallet instead.
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
        <button className="btn-primary" onClick={() => privy.login()}>
          Sign in
        </button>
      </div>
    );
  }

  const rows = linkedRows(privy.user);
  const socials = rows.filter((row) => row.kind !== "wallet");
  const wallets = rows.filter((row) => row.kind === "wallet");
  const hasKind = (kind: AccountKind) => rows.some((row) => row.kind === kind);

  const link: Record<(typeof SOCIAL_KINDS)[number], () => void> = {
    twitter: privy.linkTwitter,
    discord: privy.linkDiscord,
  };

  async function unlink(row: LinkedRow) {
    setBusy(row.id);
    try {
      switch (row.kind) {
        case "email":
          await privy.unlinkEmail(row.id);
          break;
        case "google":
          await privy.unlinkGoogle(row.id);
          break;
        case "twitter":
          await privy.unlinkTwitter(row.id);
          break;
        case "discord":
          await privy.unlinkDiscord(row.id);
          break;
        case "wallet":
          await privy.unlinkWallet(row.id);
          break;
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
      <section className="page-section px-5 py-5">
        <h2 className="text-lg font-semibold">Your Club rewards</h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          What Clubs have paid this wallet from their swap fees. Rewards go to your Club wallet (the one each Club’s Members list shows); switch to it below to
          see its rewards here.
        </p>
        <RewardsClaim account={active} />
      </section>

      <section className="page-section px-5 py-5">
        <h2 className="text-lg font-semibold">Linked accounts</h2>
        <p className="mt-1 text-sm text-muted">
          Link an X or Discord account to your wallet to sign in with it later, without opening your wallet first. They are for signing in and recovery. You
          need an X or Discord account linked to post on a Club’s Board, and an X account for your X posts to count. Nothing is shown to other traders unless
          you turn it on in your{" "}
          <Link href="/profile" className="font-bold underline">
            profile
          </Link>
          .
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
          {wallets.length === 0 && <li className="text-sm text-muted">No wallet linked yet. Link the one you trade with.</li>}
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
                    <button className="btn-secondary" onClick={() => privy.connectWallet()}>
                      Connect
                    </button>
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
            The embedded wallet is made for you at sign-in and only you can use it. Export its key somewhere safe if it will hold anything you care about:
            anyone with the key controls it.
          </p>
        )}
        <p className="mt-3 text-xs text-muted">A wallet can be linked to one account only. Unlinking removes it from sign-in, not from the wallet itself.</p>
      </section>
    </div>
  );
}

function Row({ row, busy, onUnlink, badge, extra }: { row: LinkedRow; busy: boolean; onUnlink: () => void; badge?: string; extra?: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-line/70 px-3 py-2.5">
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          {row.embedded ? "Embedded wallet" : KIND_LABEL[row.kind]}
          {badge && <span className="rounded-full bg-mint/15 px-2 py-0.5 text-[0.65rem] text-mint">{badge}</span>}
        </span>
        <span className="truncate font-mono text-sm">{row.kind === "wallet" ? <CopyAddress address={row.label} /> : row.label}</span>
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
