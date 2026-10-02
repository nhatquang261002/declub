import type { Address } from "viem";
import { toAsset, type Asset, type RawAsset } from "./assets";

export type ProposalStatus = "active" | "accepted" | "withdrawn" | "rejected";

/** A taker's answer to an open offer (OnDealV2.Proposal). `assets` sit in escrow while it is active. */
export type ProposalV2 = {
  dealId: bigint;
  /** Index within the deal, oldest first. */
  id: bigint;
  proposer: Address;
  status: ProposalStatus;
  assets: readonly Asset[];
};

/** The shape `getProposal` / `getProposals` return (IOnDealV2.Proposal). */
export type RawProposal = { proposer: Address; status: number; assets: readonly RawAsset[] };

const STATUS: Record<number, ProposalStatus> = { 1: "active", 2: "accepted", 3: "withdrawn", 4: "rejected" };

/** null for status None or an asset type this build doesn't know. */
export function toProposal(dealId: bigint, id: bigint, raw: RawProposal): ProposalV2 | null {
  const status = STATUS[raw.status];
  if (!status) return null;
  const assets = raw.assets.map(toAsset);
  if (assets.includes(null)) return null;
  return { dealId, id, proposer: raw.proposer, status, assets: assets as Asset[] };
}
