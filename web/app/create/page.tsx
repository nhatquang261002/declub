"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress, parseEventLogs, type Address } from "viem";
import { useConnection } from "wagmi";
import { ChogPicker } from "@/components/Chog";
import { PageHeader, RequireWallet } from "@/components/Page";
import { TxButton, TxStatus } from "@/components/Tx";
import { useChogApproval } from "@/hooks/useChogApproval";
import { useChogCatalog, useChogOwners, useOwnedChogs } from "@/hooks/useChogs";
import { useTxFlow } from "@/hooks/useTxFlow";
import { chogSwapAbi } from "@/lib/abi";
import { DEMO_CREATE, MAX_TOKENS_PER_SIDE } from "@/lib/config";
import { swap } from "@/lib/contracts";
import { parseIds, parseMon } from "@/lib/format";
import { buildMerkleSet } from "@/lib/merkle";
import { CHOG_ADDRESS } from "@/lib/config";
import type { ChogMetadata } from "@/lib/metadata";
import { TraitRequestSummary } from "@/components/TraitRequest";

type Expiry = "1h" | "24h" | "7d" | "none";
const DURATIONS: Record<Exclude<Expiry, "none">, number> = { "1h": 3600, "24h": 86400, "7d": 604800 };

export default function CreatePage() {
  return (
    <>
      <PageHeader title="Create a trade" />
      {DEMO_CREATE ? (
        <CreateTrade preview />
      ) : (
        <RequireWallet reason="Connect a wallet to create a trade.">
          <CreateTrade />
        </RequireWallet>
      )}
    </>
  );
}

function CreateTrade({ preview = false }: { preview?: boolean }) {
  const { address } = useConnection();
  const router = useRouter();
  const { ids, isLoading } = useOwnedChogs(address);
  const catalog = useChogCatalog();
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
  const [requestMode, setRequestMode] = useState<"ids" | "trait">("ids");
  const [traitType, setTraitType] = useState("");
  const [traitValue, setTraitValue] = useState("");

  const requested = useMemo(() => parseIds(requestedText) ?? [], [requestedText]);
  const offeredMon = parseMon(offeredMonText);
  const requestedMon = parseMon(requestedMonText);
  const { owners: requestedOwnerMap, isLoading: ownersLoading } = useChogOwners(requested);
  const requestedOwners = requested.map((id) => requestedOwnerMap.get(id));
  const ownerHint = requestedOwners.filter((owner) => owner && owner.toLowerCase() !== address?.toLowerCase()).length;
  const previewIds = [1159n, 1376n, 143n, 67n, 909n];
  const catalogEntries = preview
    ? catalog.entries.filter(({ id }) => previewIds.includes(id))
    : catalog.entries;
  const previewCatalog = [
    { id: 1159n, metadata: { name: "Chog #1159", image: null, attributes: [{ trait_type: "Hat", value: "Crown" }, { trait_type: "Eyes", value: "Blue" }, { trait_type: "Background", value: "Purple" }] } },
    { id: 1376n, metadata: { name: "Chog #1376", image: null, attributes: [{ trait_type: "Hat", value: "Wizard Hat" }, { trait_type: "Eyes", value: "Laser" }, { trait_type: "Background", value: "Mint" }] } },
    { id: 143n, metadata: { name: "Chog #143", image: null, attributes: [{ trait_type: "Hat", value: "Beanie" }, { trait_type: "Eyes", value: "Green" }, { trait_type: "Background", value: "Sunset" }] } },
    { id: 67n, metadata: { name: "Chog #67", image: null, attributes: [{ trait_type: "Hat", value: "Crown" }, { trait_type: "Eyes", value: "Sleepy" }, { trait_type: "Background", value: "Night" }] } },
    { id: 909n, metadata: { name: "Chog #909", image: null, attributes: [{ trait_type: "Hat", value: "Cowboy Hat" }, { trait_type: "Eyes", value: "Blue" }, { trait_type: "Background", value: "Mint" }] } },
  ] satisfies { id: bigint; metadata: ChogMetadata }[];
  const traitCatalog = preview ? previewCatalog : catalogEntries;
  const traitOptions: { trait_type: string; value: string }[] = Array.from(new Map<string, { trait_type: string; value: string }>(traitCatalog.flatMap(({ metadata }: { metadata: ChogMetadata }) =>
    metadata.attributes.filter((attribute) => attribute.value !== "None")
      .map((attribute) => [`${attribute.trait_type}:${attribute.value}`, attribute] as [string, { trait_type: string; value: string }]),
  )).values());
  const traitIds = traitCatalog
    .filter(({ metadata }) => metadata.attributes.some(
      (attribute) => attribute.trait_type === traitType && attribute.value === traitValue,
    ))
    .map(({ id }) => id);
  const traitSet = buildMerkleSet(traitIds, CHOG_ADDRESS);

  function toggle(id: bigint) {
    setOffered((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  async function create() {
    if (!address) return;
    const taker = takerText.trim();
    const takerAddress = taker ? (isAddress(taker) ? (taker as Address) : null) : null;
    if (offered.length === 0 && (offeredMon ?? 0n) === 0n) return setValidation("Offer at least one asset or some MON.");
    if (requestMode === "ids" && requested.length === 0 && (requestedMon ?? 0n) === 0n) return setValidation("Request at least one asset, a trait, or some MON.");
    if (requestMode === "trait" && traitSet.count === 0 && (requestedMon ?? 0n) === 0n) return setValidation("Choose a trait that matches at least one asset.");
    if ((offeredMon ?? 0n) > 0n && (requestedMon ?? 0n) > 0n) return setValidation("MON can only be on one side.");
    if (offered.length > MAX_TOKENS_PER_SIDE || requested.length > MAX_TOKENS_PER_SIDE) return setValidation(`Up to ${MAX_TOKENS_PER_SIDE} assets per side.`);
    if (requestMode === "ids" && new Set(requested.map(String)).size !== requested.length) return setValidation("Requested asset IDs must be unique.");
    if (offered.some((id) => requested.includes(id))) return setValidation("An asset cannot be on both sides.");
    if (taker && !takerAddress) return setValidation("Enter a valid wallet address, or leave it empty.");
    if (takerAddress?.toLowerCase() === address.toLowerCase()) return setValidation("You cannot make a private offer to yourself.");
    if (requestMode === "ids" && ownersLoading) return setValidation("Still checking requested assets.");
    if (requestMode === "ids" && requestedOwners.some((owner) => owner === null)) return setValidation("Every requested asset must exist.");
    if (requestMode === "ids" && ownerHint > 0 && takerAddress) return setValidation("The private taker does not currently own every requested asset.");
    if (offeredMon === null || requestedMon === null) return setValidation("Enter valid MON amounts.");
    const expiryValue = expiry === "none" ? 0n : BigInt(Math.floor(Date.now() / 1000) + DURATIONS[expiry]);
    setValidation(null);
    const takerValue = (takerAddress ?? "0x0000000000000000000000000000000000000000") as Address;
    const receipt = await tx.run(requestMode === "trait"
      ? { ...swap, functionName: "createTrade", args: [offered, traitSet.root, traitSet.count, requestedMon, takerValue, expiryValue], value: offeredMon }
      : { ...swap, functionName: "createTrade", args: [offered, requested, requestedMon, takerValue, expiryValue], value: offeredMon });
    if (!receipt) return;
    const logs = parseEventLogs({
      abi: chogSwapAbi,
      eventName: requestMode === "trait" ? "TraitTradeCreated" : "TradeCreated",
      logs: receipt.logs,
    });
    const id = logs[0]?.args.tradeId;
    if (id !== undefined) router.push(`/trade/${id.toString()}`);
  }

  return (
    <div className="space-y-8">
      <section>
        <label className="label">Assets you offer</label>
        <ChogPicker ids={preview ? previewIds : ids} selected={offered} onToggle={toggle} max={MAX_TOKENS_PER_SIDE} isLoading={!preview && isLoading} empty="No assets available. Mint or receive one first." preferLocalArtwork={preview} />
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
      <section className="page-section space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          {(["ids", "trait"] as const).map((mode) => (
            <button key={mode} type="button" className={requestMode === mode ? "btn-primary" : "btn-secondary"} onClick={() => setRequestMode(mode)}>
              {mode === "ids" ? "Request exact assets" : "Request by trait"}
            </button>
          ))}
        </div>
        {requestMode === "ids" ? (
          <>
            <label className="label" htmlFor="requested-ids">Asset IDs you request</label>
            <input id="requested-ids" className="input" placeholder="1, 2, #3" value={requestedText} onChange={(e) => setRequestedText(e.target.value)} />
            <p className="mt-1 text-xs text-muted">Separate ids with commas or spaces. {requestedOwners.length > 0 && `${requestedOwners.length} token${requestedOwners.length === 1 ? "" : "s"} checked.`}</p>
          </>
        ) : (
          <>
            <div>
              <label className="label">Any asset matching</label>
              <p className="text-xs text-muted">The contract will accept any token in the committed matching set.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <select className="input" value={traitType} onChange={(e) => { setTraitType(e.target.value); setTraitValue(""); }}>
                <option value="">Trait type</option>
                {[...new Set(traitOptions.map((option) => option.trait_type))].sort().map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <select className="input" value={traitValue} disabled={!traitType || (!preview && catalog.isLoading)} onChange={(e) => setTraitValue(e.target.value)}>
                <option value="">Trait value</option>
                {traitOptions.filter((option) => option.trait_type === traitType).map((option) => <option key={option.value} value={option.value}>{option.value}</option>)}
              </select>
            </div>
            {traitSet.count > 0 && (
              <TraitRequestSummary
                filter={{ traitType, value: traitValue }}
                count={traitSet.count}
                root={traitSet.root}
              />
            )}
            {!preview && catalog.isLoading && <p className="text-xs text-muted">Loading the catalog…</p>}
          </>
        )}
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
        {preview && (
          <p className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent">
            Preview mode — connect a wallet to approve and create a real trade.
          </p>
        )}
        <p className="text-sm text-muted">On Deal locks your offered assets in escrow. The requested side is transferred only when someone accepts.</p>
        {validation && <p className="text-sm text-danger" role="alert">{validation}</p>}
        {!isApproved ? (
          <TxButton state={approval.state} disabled={preview} onClick={() => approval.run(approveCall)}>Create Trade</TxButton>
        ) : (
          <TxButton state={tx.state} disabled={preview} onClick={create}>Create Trade</TxButton>
        )}
        <TxStatus state={approval.state} success="On Deal is approved." />
        <TxStatus state={tx.state} success="Trade created." />
      </div>
    </div>
  );
}
