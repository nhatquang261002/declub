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
        <button
          className="btn-danger"
          disabled={switchChain.isPending}
          onClick={() => switchChain.mutate({ chainId: chain.id })}
        >
          Switch to {chain.name}
        </button>
      );
    }
    return (
      <div className="flex items-center gap-2">
        <a
          href={explorerAddress(address)}
          target="_blank"
          rel="noreferrer"
          className="rounded-xl border border-line bg-panel-2 px-3 py-2 font-mono text-sm hover:border-accent"
        >
          {shortAddress(address)}
        </a>
        <button className="btn-secondary px-3" onClick={() => disconnect.mutate({})}>
          Disconnect
        </button>
      </div>
    );
  }

  // EIP-6963 lists every installed wallet; the generic "Injected" one is a fallback.
  const wallets = connectors.length > 1 ? connectors.filter((c) => c.id !== "injected") : connectors;

  return (
    <div className="relative">
      <button
        className="btn-primary"
        disabled={status === "connecting" || status === "reconnecting"}
        onClick={() =>
          wallets.length === 1 ? connect.mutate({ connector: wallets[0] }) : setOpen((o) => !o)
        }
      >
        {status === "connecting" ? "Connecting…" : "Connect wallet"}
      </button>

      {open && wallets.length > 1 && (
        <div className="card absolute right-0 z-20 mt-2 w-56 p-1.5 shadow-xl">
          {wallets.map((connector) => (
            <button
              key={connector.uid}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-panel-2"
              onClick={() => {
                setOpen(false);
                connect.mutate({ connector });
              }}
            >
              {connector.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={connector.icon} alt="" className="size-5 rounded" />
              )}
              {connector.name}
            </button>
          ))}
        </div>
      )}

      {connect.error && (
        <p className="absolute right-0 mt-2 w-64 text-right text-xs text-danger">
          {String(connect.error.name) === "ProviderNotFoundError"
            ? "No wallet found. Install MetaMask, Rabby or another EVM wallet."
            : errorMessage(connect.error)}
        </p>
      )}
    </div>
  );
}
