"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress, parseEventLogs, type Address } from "viem";
import { useConnection } from "wagmi";
import { ChogPicker } from "@/components/Chog";
import { PageHeader, RequireWallet } from "@/components/Page";
import { TxButton, TxStatus } from "@/components/Tx";
import { useChogApproval } from "@/hooks/useChogApproval";
import { useChogOwners, useOwnedChogs } from "@/hooks/useChogs";
import { useTxFlow } from "@/hooks/useTxFlow";
import { chogSwapAbi } from "@/lib/abi";
import { MAX_TOKENS_PER_SIDE } from "@/lib/config";
import { swap } from "@/lib/contracts";
import { parseIds, parseMon } from "@/lib/format";

type Expiry = "1h" | "24h" | "7d" | "none";
const DURATIONS: Record<Exclude<Expiry, "none">, number> = { "1h": 3600, "24h": 86400, "7d": 604800 };

export default function CreatePage() {
  return (
    <>
      <PageHeader title="Create a trade" />
      <RequireWallet reason="Connect a wallet to create a trade.">
        <CreateTrade />
      </RequireWallet>
    </>
  );
}

function CreateTrade() {
  const { address } = useConnection();
  const router = useRouter();
  const { ids, isLoading } = useOwnedChogs(address);
  const { isApproved, approveCall } = useChogApproval(address);
  const approval = useTxFlow();
  const tx = useTxFlow();
  const [offered, setOffered] = useState<bigint[]>(() => {
    if (typeof window === "undefined") return [];
    const offer = new URLSearchParams(window.location.search).get("offer");
    return offer && /^\d+$/.test(offer) ? [BigInt(offer)] : [];
  });
  const [requestedText, setRequestedText] = useState("");
  const [offeredMonText, setOfferedMonText] = useState("");
  const [requestedMonText, setRequestedMonText] = useState("");
  const [takerText, setTakerText] = useState("");
  const [expiry, setExpiry] = useState<Expiry>("24h");
  const [validation, setValidation] = useState<string | null>(null);

  const requested = useMemo(() => parseIds(requestedText) ?? [], [requestedText]);
  const offeredMon = parseMon(offeredMonText);
  const requestedMon = parseMon(requestedMonText);
  const { owners: requestedOwnerMap, isLoading: ownersLoading } = useChogOwners(requested);
  const requestedOwners = requested.map((id) => requestedOwnerMap.get(id));
  const ownerHint = requestedOwners.filter((owner) => owner && owner.toLowerCase() !== address?.toLowerCase()).length;

  function toggle(id: bigint) {
    setOffered((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  async function create() {
    if (!address) return;
    const taker = takerText.trim();
    const takerAddress = taker ? (isAddress(taker) ? (taker as Address) : null) : null;
    if (offered.length === 0 && (offeredMon ?? 0n) === 0n) return setValidation("Offer at least one Chog or some MON.");
    if (requested.length === 0 && (requestedMon ?? 0n) === 0n) return setValidation("Request at least one Chog or some MON.");
    if ((offeredMon ?? 0n) > 0n && (requestedMon ?? 0n) > 0n) return setValidation("MON can only be on one side.");
    if (offered.length > MAX_TOKENS_PER_SIDE || requested.length > MAX_TOKENS_PER_SIDE) return setValidation(`Up to ${MAX_TOKENS_PER_SIDE} Chogs per side.`);
    if (new Set(requested.map(String)).size !== requested.length) return setValidation("Requested Chog ids must be unique.");
    if (offered.some((id) => requested.includes(id))) return setValidation("A Chog cannot be on both sides.");
    if (taker && !takerAddress) return setValidation("Enter a valid wallet address, or leave it empty.");
    if (takerAddress?.toLowerCase() === address.toLowerCase()) return setValidation("You cannot make a private offer to yourself.");
    if (ownersLoading) return setValidation("Still checking requested Chogs.");
    if (requestedOwners.some((owner) => owner === null)) return setValidation("Every requested Chog must exist.");
    if (ownerHint > 0 && takerAddress) return setValidation("The private taker does not currently own every requested Chog.");
    if (offeredMon === null || requestedMon === null) return setValidation("Enter valid MON amounts.");
    const expiryValue = expiry === "none" ? 0n : BigInt(Math.floor(Date.now() / 1000) + DURATIONS[expiry]);
    setValidation(null);
    const receipt = await tx.run({
      ...swap,
      functionName: "createTrade",
      args: [offered, requested, requestedMon, (takerAddress ?? "0x0000000000000000000000000000000000000000") as Address, expiryValue],
      value: offeredMon,
    });
    if (!receipt) return;
    const logs = parseEventLogs({ abi: chogSwapAbi, eventName: "TradeCreated", logs: receipt.logs });
    const id = logs[0]?.args.tradeId;
    if (id !== undefined) router.push(`/trade/${id.toString()}`);
  }

  return (
    <div className="space-y-8">
      <section>
        <label className="label">Chogs you offer</label>
        <ChogPicker ids={ids} selected={offered} onToggle={toggle} max={MAX_TOKENS_PER_SIDE} isLoading={isLoading} empty="No Chogs available. Mint or receive one first." />
      </section>
      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="offered-mon">MON you offer</label>
          <input id="offered-mon" className="input" inputMode="decimal" placeholder="0" value={offeredMonText} onChange={(e) => setOfferedMonText(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="requested-mon">MON you request</label>
          <input id="requested-mon" className="input" inputMode="decimal" placeholder="0" value={requestedMonText} onChange={(e) => setRequestedMonText(e.target.value)} />
        </div>
      </section>
      <section>
        <label className="label" htmlFor="requested-ids">Chog ids you request</label>
        <input id="requested-ids" className="input" placeholder="1, 2, #3" value={requestedText} onChange={(e) => setRequestedText(e.target.value)} />
        <p className="mt-1 text-xs text-muted">Separate ids with commas or spaces. {requestedOwners.length > 0 && `${requestedOwners.length} token${requestedOwners.length === 1 ? "" : "s"} checked.`}</p>
      </section>
      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="taker">Only this wallet can accept (optional)</label>
          <input id="taker" className="input font-mono" placeholder="0x…" value={takerText} onChange={(e) => setTakerText(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="expiry">Expiry</label>
          <select id="expiry" className="input" value={expiry} onChange={(e) => setExpiry(e.target.value as Expiry)}>
            <option value="1h">1 hour</option><option value="24h">24 hours</option><option value="7d">7 days</option><option value="none">Never</option>
          </select>
        </div>
      </section>
      <div className="card space-y-3 p-4">
        <p className="text-sm text-muted">Chog Swap locks your offered Chogs in escrow. The requested side is transferred only when someone accepts.</p>
        {validation && <p className="text-sm text-danger" role="alert">{validation}</p>}
        {!isApproved ? (
          <TxButton state={approval.state} onClick={() => approval.run(approveCall)}>Approve Chog Swap</TxButton>
        ) : (
          <TxButton state={tx.state} onClick={create}>Create trade</TxButton>
        )}
        <TxStatus state={approval.state} success="Chog Swap is approved." />
        <TxStatus state={tx.state} success="Trade created." />
      </div>
    </div>
  );
}
