"use client";

import { useState } from "react";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { explorerAddress } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import { shortAddress } from "@/lib/format";
import { chain } from "@/lib/wagmi";

export function ConnectButton() {
  const { address, chainId, status } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const [open, setOpen] = useState(false);

  if (status === "connected" && address) {
    if (chainId !== chain.id) {
      return (
        <div className="relative">
          <button
            className="wallet-control wallet-control-warning"
            disabled={switchChain.isPending}
            onClick={() => switchChain.mutate({ chainId: chain.id })}
          >
            <span className="wallet-status-dot" aria-hidden />
            <span>{switchChain.isPending ? "Switching network…" : `Switch to ${chain.name}`}</span>
          </button>
        </div>
      );
    }
    return (
      <div className="relative">
        <button
          className="wallet-control"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="wallet-status-dot" aria-hidden />
          <span className="font-mono">{shortAddress(address)}</span>
          <span className={`wallet-chevron ${open ? "wallet-chevron-open" : ""}`} aria-hidden>⌄</span>
        </button>
        {open && (
          <div className="wallet-menu" role="menu">
            <div className="wallet-menu-account">
              <span className="wallet-menu-label">Connected wallet</span>
              <span className="truncate font-mono text-sm text-white">{address}</span>
              <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-mint/10 px-2 py-1 text-xs font-semibold text-mint">
                <span className="wallet-status-dot wallet-status-dot-small" aria-hidden />
                {chain.name}
              </span>
            </div>
            <a
              href={explorerAddress(address)}
              target="_blank"
              rel="noreferrer"
              className="wallet-menu-item"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              <span>View on explorer</span><span aria-hidden>↗</span>
            </a>
            <button
              className="wallet-menu-item wallet-menu-item-danger"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                disconnect.mutate({});
              }}
            >
              <span>Disconnect wallet</span><span aria-hidden>↪</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // EIP-6963 lists every installed wallet; the generic "Injected" one is a fallback.
  const wallets = connectors.length > 1 ? connectors.filter((c) => c.id !== "injected") : connectors;

  return (
    <div className="relative">
      <button
        className="btn-secondary"
        disabled={status === "connecting" || status === "reconnecting"}
        onClick={() =>
          wallets.length === 1 ? connect.mutate({ connector: wallets[0] }) : setOpen((o) => !o)
        }
      >
        <WalletIcon />
        <span>{status === "connecting" || status === "reconnecting" ? "Connecting…" : "Connect wallet"}</span>
        {wallets.length > 1 && <span className={`wallet-chevron ${open ? "wallet-chevron-open" : ""}`} aria-hidden>⌄</span>}
      </button>

      {open && wallets.length > 1 && (
        <div className="wallet-menu" role="menu">
          <div className="wallet-menu-account">
            <span className="wallet-menu-label">Connect a wallet</span>
            <span className="text-xs leading-5 text-white/60">Choose an installed wallet to continue.</span>
          </div>
          {wallets.map((connector) => (
            <button
              key={connector.uid}
              className="wallet-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                connect.mutate({ connector });
              }}
            >
              <span className="flex items-center gap-3">
                {connector.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={connector.icon} alt="" className="size-6 rounded-lg" />
                ) : <WalletIcon />}
                <span>{connector.name}</span>
              </span>
              <span aria-hidden>→</span>
            </button>
          ))}
        </div>
      )}

      {connect.error && (
        <p className="wallet-error">
          {String(connect.error.name) === "ProviderNotFoundError"
            ? "No wallet found. Install MetaMask, Rabby or another EVM wallet."
            : errorMessage(connect.error)}
        </p>
      )}
    </div>
  );
}

function WalletIcon() {
  return (
    <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19a1 1 0 0 1 1 1v2H7a3 3 0 0 0 0 6h13v3a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5v-9Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 8H7a3 3 0 0 0 0 6h13v-6Z" />
      <circle cx="16.5" cy="11" r=".8" fill="currentColor" stroke="none" />
    </svg>
  );
}
