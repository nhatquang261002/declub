"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { CheckIcon, ChevronIcon, CopyIcon, ExternalIcon, PlusIcon, SettingsIcon, ShieldIcon, SignOutIcon, UserIcon, WalletIcon } from "@/components/Icons";
import { usePopover } from "@/components/Popover";
import { useToast } from "@/components/Toast";
import { WalletAvatar } from "@/components/WalletAvatar";
import { profilePath } from "@/lib/about";
import { linkedRows, signedInAs } from "@/lib/accounts";
import { explorerAddress, PRIVY_APP_ID, PRIVY_EMBEDDED_WALLETS } from "@/lib/config";
import { shortAddress } from "@/lib/format";
import { chain } from "@/lib/wagmi";
import { useCopy } from "@/components/CopyAddress";

/**
 * PRIVY_APP_ID is fixed at build time, so exactly one of these renders for the life of the app and
 * the hooks inside each keep a stable order. Privy's hooks only work under its provider.
 */
export function ConnectButton() {
  return PRIVY_APP_ID ? <PrivyConnect /> : <InjectedConnect />;
}

function MenuItem({
  icon,
  children,
  danger,
  ...props
}: {
  icon: ReactNode;
  children: ReactNode;
  danger?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button role="menuitem" className={`hdr-pop-item ${danger ? "hdr-pop-item-danger" : ""}`} {...props}>
      <span className="hdr-pop-icon">{icon}</span>
      <span className="flex-1">{children}</span>
    </button>
  );
}

/** Copies text, and says so for a moment. */
function CopyButton({ text }: { text: string }) {
  const [copied, copy] = useCopy();
  return (
    <button
      type="button"
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/20 px-2 py-1 text-[0.7rem] font-bold text-white/80 hover:bg-white/10 hover:text-white"
      onClick={() => copy(text)}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** The top of a menu: who is signed in, then whatever `children` say about the wallet. */
function MenuHead({ who, children }: { who?: string | null; children: ReactNode }) {
  return (
    <div className="hdr-pop-head">
      {who && <span className="text-sm font-bold text-white">{who}</span>}
      {children}
    </div>
  );
}

/** The header button that opens a wallet menu: avatar, who is signed in (when known), a label, and a chevron. */
function MenuTrigger({ open, onToggle, avatar, who, children }: { open: boolean; onToggle: () => void; avatar: ReactNode; who?: string; children: ReactNode }) {
  return (
    <button className="hdr-btn" aria-expanded={open} aria-haspopup="menu" onClick={onToggle}>
      {avatar}
      <span className="hdr-btn-text">
        {who && <span className="hdr-btn-sub hidden sm:block">{who}</span>}
        {children}
      </span>
      <ChevronIcon className="hdr-chevron size-4" />
    </button>
  );
}

/** The connected state both modes share: the network switch, the address menu and sign out. */
function ConnectedWallet({
  address,
  chainId,
  onDisconnect,
  disconnectLabel,
  signedInAs: who,
  accountLink,
}: {
  address: `0x${string}`;
  chainId: number | undefined;
  onDisconnect: () => void;
  disconnectLabel: string;
  /** Privy mode: the email or handle the user signed in with. */
  signedInAs?: string;
  /** Privy mode: show the link to the account settings. */
  accountLink?: boolean;
}) {
  const switchChain = useSwitchChain();
  const { open, setOpen, ref } = usePopover();
  const toast = useToast();

  // A refused network switch toasts at the top of the screen instead of hanging off the button.
  const switchError = switchChain.error;
  useEffect(() => {
    if (switchError) toast.error(switchError);
  }, [switchError, toast]);

  if (chainId !== chain.id) {
    return (
      <button className="hdr-btn hdr-btn-warn !pl-3" disabled={switchChain.isPending} onClick={() => switchChain.mutate({ chainId: chain.id })}>
        <span>
          {switchChain.isPending ? (
            "Switching…"
          ) : (
            <>
              Switch<span className="hidden sm:inline"> to {chain.name}</span>
              <span className="sm:hidden"> network</span>
            </>
          )}
        </span>
      </button>
    );
  }

  return (
    <div className="hdr-anchor" ref={ref}>
      <MenuTrigger
        open={open}
        onToggle={() => setOpen((value) => !value)}
        avatar={
          <WalletAvatar seed={address}>
            <span className="avatar-dot" />
          </WalletAvatar>
        }
        who={who}
      >
        {/* The menu shows the address; on a phone the avatar alone leaves the header room for one row. */}
        <span className="hidden font-mono sm:inline">{shortAddress(address)}</span>
      </MenuTrigger>

      {open && (
        <div className="hdr-pop" role="menu">
          <MenuHead who={who}>
            <span className="hdr-pop-label mt-1">Wallet</span>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="truncate font-mono text-sm text-white" title={address}>
                {shortAddress(address)}
              </span>
              <CopyButton text={address} />
            </div>
            <span className="hdr-chip mt-2.5">{chain.name}</span>
          </MenuHead>
          <Link href={profilePath(address)} className="hdr-pop-item" role="menuitem" onClick={() => setOpen(false)}>
            <span className="hdr-pop-icon">
              <UserIcon />
            </span>
            <span className="flex-1">Your profile</span>
          </Link>
          <Link href="/approvals" className="hdr-pop-item" role="menuitem" onClick={() => setOpen(false)}>
            <span className="hdr-pop-icon">
              <ShieldIcon />
            </span>
            <span className="flex-1">Your approvals</span>
          </Link>
          {accountLink && (
            <Link href="/settings" className="hdr-pop-item" role="menuitem" onClick={() => setOpen(false)}>
              <span className="hdr-pop-icon">
                <SettingsIcon />
              </span>
              <span className="flex-1">Account settings</span>
            </Link>
          )}
          <a href={explorerAddress(address)} target="_blank" rel="noreferrer" className="hdr-pop-item" role="menuitem" onClick={() => setOpen(false)}>
            <span className="hdr-pop-icon">
              <ExternalIcon />
            </span>
            <span className="flex-1">View on explorer</span>
          </a>
          <div className="hdr-pop-sep" />
          <MenuItem
            danger
            icon={<SignOutIcon />}
            onClick={() => {
              setOpen(false);
              onDisconnect();
            }}
          >
            {disconnectLabel}
          </MenuItem>
        </div>
      )}
    </div>
  );
}

/**
 * Signed in, but no wallet reached wagmi. Either the account has a wallet linked that isn't
 * connected in this browser yet (the usual case for a returning Google / X / Discord sign-in), or
 * it has none. Either way the header needs a way forward and a way out, so this menu offers
 * connecting or linking a wallet, and always sign out.
 */
function NoWalletMenu({
  who,
  settingUp,
  linkedWallets,
  canCreate,
  creating,
  onConnect,
  onLink,
  onCreate,
  onSignOut,
}: {
  who?: string;
  /** Privy is still loading the user's wallets: a wallet may arrive on its own. */
  settingUp: boolean;
  /** Addresses already linked to this account. */
  linkedWallets: string[];
  /** Embedded wallets are on, so one can be created here. */
  canCreate: boolean;
  creating: boolean;
  onConnect: () => void;
  onLink: () => void;
  onCreate: () => void;
  onSignOut: () => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const hasLinked = linkedWallets.length > 0;
  return (
    <div className="hdr-anchor" ref={ref}>
      <MenuTrigger
        open={open}
        onToggle={() => setOpen((v) => !v)}
        avatar={
          <WalletAvatar>
            <UserIcon className="size-3.5 text-white/80" />
          </WalletAvatar>
        }
        who={who}
      >
        <span>{settingUp ? "Setting up…" : hasLinked ? "Connect wallet" : "Link a wallet"}</span>
      </MenuTrigger>
      {open && (
        <div className="hdr-pop" role="menu">
          <MenuHead who={who}>
            <p className="mt-1 text-xs leading-5 text-white/65">
              {settingUp
                ? "Loading your wallets. This takes a moment."
                : hasLinked
                  ? "You're signed in. Connect the wallet linked to your account to trade."
                  : "You're signed in, but no wallet is linked to this account yet. Link the wallet you trade with."}
            </p>
          </MenuHead>
          {linkedWallets.map((address) => (
            <MenuItem key={address} icon={<WalletIcon />} onClick={onConnect}>
              Connect <span className="font-mono">{shortAddress(address as `0x${string}`)}</span>
            </MenuItem>
          ))}
          <MenuItem icon={hasLinked ? <PlusIcon /> : <WalletIcon />} onClick={onLink}>
            {hasLinked ? "Link another wallet" : "Link a wallet"}
          </MenuItem>
          {canCreate && !hasLinked && (
            <MenuItem icon={<PlusIcon />} disabled={creating} onClick={onCreate}>
              {creating ? "Creating wallet…" : "Create an embedded wallet"}
            </MenuItem>
          )}
          <div className="hdr-pop-sep" />
          <MenuItem danger icon={<SignOutIcon />} onClick={onSignOut}>
            Sign out
          </MenuItem>
        </div>
      )}
    </div>
  );
}

/** Sign in with Privy (Google, X, Discord or a wallet); the wallet reaches wagmi from there. */
function PrivyConnect() {
  const { ready, authenticated, user, login, logout, linkWallet, connectWallet } = usePrivy();
  const wallets = useWallets();
  const { createWallet } = useCreateWallet();
  const { address, chainId, status } = useConnection();
  const disconnect = useDisconnect();
  const toast = useToast();
  const [creating, setCreating] = useState(false);

  // Privy's wagmi bridge drops its connectors when the wallet list empties but leaves wagmi's own
  // connection in place, so after a logout the header would still show the old address. Disconnect
  // wagmi first (while its connector still exists), then sign out of Privy.
  const signOut = async () => {
    try {
      await disconnect.mutateAsync({});
    } catch {
      // Already gone (the wallet was removed or locked): signing out of Privy is what matters.
    }
    if (authenticated) await logout().catch(toast.error);
  };

  if (status === "connected" && address) {
    return <ConnectedWallet address={address} chainId={chainId} onDisconnect={signOut} disconnectLabel="Sign out" signedInAs={signedInAs(user)} accountLink />;
  }

  if (authenticated) {
    return (
      <NoWalletMenu
        who={signedInAs(user)}
        settingUp={!wallets.ready || status === "connecting" || status === "reconnecting"}
        linkedWallets={linkedRows(user)
          .filter((row) => row.kind === "wallet" && !row.embedded)
          .map((row) => row.id)}
        canCreate={PRIVY_EMBEDDED_WALLETS}
        creating={creating}
        onConnect={() => connectWallet()}
        onLink={() => linkWallet()}
        onCreate={() => {
          setCreating(true);
          createWallet()
            .catch(toast.error)
            .finally(() => setCreating(false));
        }}
        onSignOut={signOut}
      />
    );
  }

  return (
    <button className="btn-secondary" disabled={!ready} onClick={() => login()}>
      <WalletIcon />
      <span>{ready ? "Sign in" : "Loading…"}</span>
    </button>
  );
}

/** No Privy: connect any injected wallet. */
function InjectedConnect() {
  const { address, chainId, status } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const { open, setOpen, ref } = usePopover();
  const toast = useToast();

  // Wallet failures (no wallet installed, a refused prompt) toast at the top of the screen
  // instead of hanging off the button until the next click.
  const connectError = connect.error;
  useEffect(() => {
    if (connectError) toast.error(connectError);
  }, [connectError, toast]);

  if (status === "connected" && address) {
    return <ConnectedWallet address={address} chainId={chainId} onDisconnect={() => disconnect.mutate({})} disconnectLabel="Disconnect wallet" />;
  }

  // EIP-6963 lists every installed wallet; the generic "Injected" one is a fallback.
  const wallets = connectors.length > 1 ? connectors.filter((c) => c.id !== "injected") : connectors;
  const connecting = status === "connecting" || status === "reconnecting";

  return (
    <div className="hdr-anchor" ref={ref}>
      <button
        className="btn-secondary"
        aria-expanded={wallets.length > 1 ? open : undefined}
        disabled={connecting}
        onClick={() => (wallets.length === 1 ? connect.mutate({ connector: wallets[0] }) : setOpen((o) => !o))}
      >
        <WalletIcon />
        <span>{connecting ? "Connecting…" : "Connect wallet"}</span>
        {wallets.length > 1 && <ChevronIcon className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>

      {open && wallets.length > 1 && (
        <div className="hdr-pop" role="menu">
          <div className="hdr-pop-head">
            <span className="hdr-pop-label">Connect a wallet</span>
            <span className="text-xs leading-5 text-white/60">Choose an installed wallet to continue.</span>
          </div>
          {wallets.map((connector) => (
            <button
              key={connector.uid}
              className="hdr-pop-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                connect.mutate({ connector });
              }}
            >
              <span className="hdr-pop-icon">
                {connector.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={connector.icon} alt="" className="size-5 rounded" />
                ) : (
                  <WalletIcon />
                )}
              </span>
              <span className="flex-1">{connector.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
