"use client";

import { useMemo, useState, type FormEvent } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { useConnection } from "wagmi";
import { ApprovalList } from "@/components/ApprovalList";
import { PageHeader, RequireWallet } from "@/components/Page";
import { useApprovals, type ApprovalTarget } from "@/hooks/useApprovals";
import { useNow } from "@/hooks/useNow";
import { useIntents } from "@/hooks/usePool";
import { useIntentFee } from "@/hooks/useProtocolFee";
import { useRecentCollections } from "@/hooks/useRecentCollections";
import { useTokenInfo } from "@/hooks/useTokenInfo";
import { isLive } from "@/lib/intents";
import { registry } from "@/lib/verifiedAssets";

export default function ApprovalsPage() {
  return (
    <>
      <PageHeader title="Your approvals" />
      <RequireWallet reason="Connect a wallet to see what DeClub's contracts may move from it.">
        <Approvals />
      </RequireWallet>
    </>
  );
}

/**
 * Every approval this wallet has given DeClub's contracts, among the contracts worth checking, with
 * a revoke button each. The chain keeps no list of a wallet's approvals, so the page reads the
 * verified assets, the collections used here lately, the fee token, what live signed swaps give, and
 * anything the person adds.
 */
function Approvals() {
  const { address } = useConnection();
  const now = useNow(30_000);
  const recents = useRecentCollections();
  const { fee } = useIntentFee();
  const { intents } = useIntents({ maker: address, status: "all", enabled: !!address });
  const [added, setAdded] = useState<Address[]>([]);

  const live = useMemo(() => intents.filter((r) => isLive(r.status) && r.intent.deadline >= BigInt(now)), [intents, now]);

  const targets = useMemo<ApprovalTarget[]>(() => {
    const out: ApprovalTarget[] = registry.verified().map((e) => ({ token: e.address, kind: e.kind }));
    for (const token of recents) out.push({ token, kind: "erc721" });
    if (fee) out.push({ token: fee.token, kind: "erc20" });
    for (const row of live) {
      for (const a of row.intent.give) if (a.kind === "erc721" || a.kind === "erc20") out.push({ token: a.token, kind: a.kind });
    }
    // An added contract is read both ways: the read that doesn't fit its kind just fails.
    for (const token of added) out.push({ token, kind: "erc721" }, { token, kind: "erc20" });
    return out;
  }, [recents, fee, live, added]);

  const { approvals, isLoading } = useApprovals(address, targets);
  const tokens = useMemo(() => [...new Set(approvals.filter((a) => a.kind === "erc20").map((a) => a.token))], [approvals]);
  const { info } = useTokenInfo(tokens);

  // What live signed swaps still pull: what they give, and the fee token.
  const needed = useMemo(() => {
    const out = new Set<string>();
    for (const row of live) for (const a of row.intent.give) out.add(`intents:${a.token.toLowerCase()}`);
    if (live.length > 0 && fee) out.add(`intents:${fee.token.toLowerCase()}`);
    return out;
  }, [live, fee]);

  return (
    <div className="space-y-6">
      <section className="page-section space-y-2 p-4 text-sm">
        <p>
          To list or accept a deal, your wallet lets DeClub&apos;s contracts move the assets in it. A deal only needs that while
          its transaction runs. A signed swap needs it until it settles or expires.
        </p>
        <p className="text-muted">
          Turn off what you no longer use. If a site you don&apos;t trust ever got you to sign something, an approval that&apos;s off
          can&apos;t be used against you.
        </p>
      </section>

      {isLoading ? (
        <p className="text-sm text-muted">Reading your approvals…</p>
      ) : approvals.length === 0 ? (
        <div className="page-section px-6 py-10 text-center">
          <p className="font-bold">Nothing to revoke</p>
          <p className="mt-1 text-sm text-muted">None of the contracts checked here can be moved by DeClub from this wallet.</p>
        </div>
      ) : (
        <ApprovalList approvals={approvals} info={info} needed={needed} />
      )}

      <AddContract onAdd={(token) => setAdded((list) => (list.some((t) => t.toLowerCase() === token.toLowerCase()) ? list : [...list, token]))} />

      <p className="text-xs text-muted">
        Checked: verified collections and tokens, collections you&apos;ve used here, the fee token, and what your live signed swaps
        give. An approval for a single NFT ends by itself when that NFT leaves your wallet.
      </p>
    </div>
  );
}

/** Adds a contract the page doesn't check on its own. */
function AddContract({ onAdd }: { onAdd: (token: Address) => void }) {
  const [value, setValue] = useState("");
  const valid = isAddress(value.trim(), { strict: false });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onAdd(getAddress(value.trim()));
    setValue("");
  }

  return (
    <form onSubmit={submit} className="page-section space-y-2 p-4">
      <label className="label" htmlFor="approval-contract">
        Check another contract
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="approval-contract"
          className="input min-w-0 flex-1 basis-64 font-mono"
          placeholder="0x… collection or token address"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="btn-secondary" disabled={!valid}>
          Check
        </button>
      </div>
    </form>
  );
}
