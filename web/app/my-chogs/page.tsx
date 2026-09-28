"use client";

import Link from "next/link";
import { useState } from "react";
import { useConnection } from "wagmi";
import { ChogCard } from "@/components/Chog";
import { EmptyState, PageHeader, RequireWallet } from "@/components/Page";
import { TxButton, TxStatus } from "@/components/Tx";
import { useChogApproval } from "@/hooks/useChogApproval";
import { useOwnedChogs } from "@/hooks/useChogs";
import { useTxFlow } from "@/hooks/useTxFlow";
import { CHOG_MINTABLE } from "@/lib/config";
import { chog } from "@/lib/contracts";

export default function MyChogsPage() {
  return (
    <>
      <PageHeader title="My Chogs" />
      <RequireWallet reason="Connect a wallet to see your Chogs.">
        <MyChogs />
      </RequireWallet>
    </>
  );
}

function MyChogs() {
  const { address } = useConnection();
  const { ids, isLoading } = useOwnedChogs(address);
  const { isApproved } = useChogApproval(address);

  return (
    <div className="space-y-6">
      {CHOG_MINTABLE && <MintPanel />}

      <p className="text-sm text-muted">
        {ids.length} Chog{ids.length === 1 ? "" : "s"} in this wallet · On Deal is{" "}
        {isApproved ? (
          <span className="text-mint">approved</span>
        ) : (
          <span>not approved yet (you&apos;ll be asked once, when you first trade)</span>
        )}
        . Chogs locked in your open trades are held by the escrow and don&apos;t show here.
      </p>

      {isLoading ? (
        <EmptyState>Loading your Chogs…</EmptyState>
      ) : ids.length === 0 ? (
        <EmptyState>
          No Chogs in this wallet{CHOG_MINTABLE ? ". Mint a few test Chogs above." : "."}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {ids.map((id) => (
            <ChogCard key={id.toString()} id={id}>
              <Link href={`/create?offer=${id}`} className="btn-secondary mt-3 w-full py-1.5 text-xs">
                Trade this
              </Link>
            </ChogCard>
          ))}
        </div>
      )}
    </div>
  );
}

/** MockChog's open mint, so demo wallets can get Chogs without the deployer. */
function MintPanel() {
  const { address } = useConnection();
  const [quantity, setQuantity] = useState(5);
  const tx = useTxFlow();

  return (
    <div className="card flex flex-wrap items-center gap-3 p-4">
      <div className="mr-auto">
        <div className="font-semibold">Need test Chogs?</div>
        <div className="text-sm text-muted">MockChog has an open mint on testnet.</div>
      </div>
      <select
        className="input w-auto"
        value={quantity}
        onChange={(e) => setQuantity(Number(e.target.value))}
        aria-label="Quantity"
      >
        {[1, 3, 5, 10].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <TxButton
        state={tx.state}
        onClick={() =>
          address &&
          tx.run({ ...chog, functionName: "mint", args: [address, BigInt(quantity)] })
        }
      >
        Mint {quantity}
      </TxButton>
      <div className="w-full empty:hidden">
        <TxStatus state={tx.state} success={`Minted ${quantity} Chogs.`} />
      </div>
    </div>
  );
}
