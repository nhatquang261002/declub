"use client";

import { useConnection } from "wagmi";
import { EmptyState, PageHeader, RequireWallet } from "@/components/Page";
import { TradeGrid } from "@/components/TradeParts";
import { TxButton, TxStatus } from "@/components/Tx";
import { useLocalFills } from "@/hooks/useLocalFills";
import { useTrades } from "@/hooks/useTrades";
import { useTxFlow } from "@/hooks/useTxFlow";
import { useNow } from "@/hooks/useNow";
import { sameAddress } from "@/lib/trades";
import { formatMon } from "@/lib/format";
import { swap } from "@/lib/contracts";
import { useReadContract } from "wagmi";

export default function HistoryPage() {
  return <><PageHeader title="History" /><RequireWallet reason="Connect a wallet to see your history."><History /></RequireWallet></>;
}

function History() {
  const { address } = useConnection();
  const { trades, isLoading } = useTrades({ limit: 200 });
  const { ids } = useLocalFills(address);
  const withdrawal = useReadContract({ ...swap, functionName: "pendingWithdrawal", args: address ? [address] : undefined });
  const tx = useTxFlow();
  const now = useNow();
  const mine = trades.filter((trade) => sameAddress(trade.maker, address) || sameAddress(trade.taker, address) || ids.some((id) => id === trade.id));

  return <div className="space-y-6">
    <div className="card flex flex-wrap items-center gap-3 p-4">
      <div className="mr-auto"><div className="font-semibold">Pending withdrawal</div><div className="text-sm text-muted">{formatMon(withdrawal.data ?? 0n)}</div></div>
      <TxButton state={tx.state} disabled={!withdrawal.data} onClick={() => tx.run({ ...swap, functionName: "withdraw", args: [] })}>Withdraw</TxButton>
      <TxStatus state={tx.state} />
    </div>
    {isLoading ? <EmptyState>Loading history…</EmptyState> : mine.length === 0 ? <EmptyState>No trades involving this wallet yet.</EmptyState> : <TradeGrid trades={mine} now={now} me={address} />}
  </div>;
}
