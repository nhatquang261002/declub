import { concat, getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import { PROTOCOL, type EpochRecord } from "../rewards";

/**
 * The check a Safe signer runs before signing `publish(epoch, root)` (scripts/rewards-verify.ts).
 * It takes a built epoch as stored and checks that it holds together: the root is the tree of its
 * leaves, every proof opens against it, the money adds up per Club and in total, and no Club paid
 * out more than its pools. Pure: the script does the reads.
 *
 * It trusts as little of the builder as it can. The leaf hashes come from the contract's own
 * `leaf()` view, and the tree and the proof check are written again here rather than imported
 * from lib/merkle.ts, so a bug or a change there can't vouch for itself.
 *
 * What it can't do is say whether the right people were paid: a record built from tampered inputs
 * (activity, holdings, fees) is still self-consistent. docs/04-security.md says so too.
 */

export type Carry = { holders: bigint; fund: bigint };

export type VerifyInput = {
  record: EpochRecord;
  /** The epoch, chain and rewards contract the signer means to publish to. */
  expected: { n: number; chainId: number; contract: Address };
  /** What rolled into each Club (lowercase) from earlier epochs; a Club not in it had nothing. */
  carriedIn: ReadonlyMap<string, Carry>;
  /** The sponsors ledger's total for each Club (lowercase) this epoch; absent means none. */
  sponsored: ReadonlyMap<string, bigint>;
  /** `DeClubRewards.leaf(n, account, amount)` for each of the record's leaves, in its order. */
  leafHashes: readonly Hex[];
  /** The previous built epoch's total, for a note. */
  previousTotal?: bigint | null;
};

type VerifyResult = { problems: string[]; notes: string[]; total: bigint };

const KINDS = ["holder", "member", "fund"] as const;
type Kind = (typeof KINDS)[number];

/** OpenZeppelin's `Hashes.commutativeKeccak256`: the smaller hash first. */
function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) <= BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

/** OpenZeppelin's `MerkleProof.processProof`. */
export function processProof(proof: readonly Hex[], leaf: Hex): Hex {
  let node = leaf;
  for (const sibling of proof) node = hashPair(node, sibling);
  return node;
}

/** The root of a sorted-pair tree over `leaves` in order, an odd last node carried up as is. */
export function merkleRoot(leaves: readonly Hex[]): Hex | null {
  if (leaves.length === 0) return null;
  let level = [...leaves];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? hashPair(level[i]!, level[i + 1]!) : level[i]!);
    level = next;
  }
  return level[0]!;
}

/** What rolled into each Club: the carry of the latest earlier epoch that lists it. */
export function carriedInFrom(earlier: readonly EpochRecord[], n: number): Map<string, Carry> {
  const out = new Map<string, Carry>();
  const sorted = earlier.filter((r) => r.n < n).sort((a, b) => b.n - a.n);
  for (const record of sorted) {
    for (const club of record.clubs) {
      const key = club.club.toLowerCase();
      if (!out.has(key)) out.set(key, { holders: BigInt(club.carry.holders), fund: BigInt(club.carry.fund) });
    }
  }
  return out;
}

const HASH = /^0x[0-9a-fA-F]{64}$/;
const WEI = /^(0|[1-9][0-9]*)$/;

export function verifyEpochRecord(input: VerifyInput): VerifyResult {
  const { record, expected } = input;
  const problems: string[] = [];
  const notes: string[] = [];
  const wei = (value: unknown, what: string): bigint => {
    if (typeof value === "string" && WEI.test(value)) return BigInt(value);
    problems.push(`${what} isn't an amount in wei: ${String(value)}`);
    return 0n;
  };

  // Where it's going.
  if (record.n !== expected.n) problems.push(`The record is epoch ${record.n}, not ${expected.n}.`);
  if (record.chainId !== expected.chainId) problems.push(`The record is for chain ${record.chainId}, not ${expected.chainId}.`);
  if (typeof record.contract !== "string" || record.contract.toLowerCase() !== expected.contract.toLowerCase()) {
    problems.push(`The record is bound to ${record.contract}, not the rewards contract ${expected.contract}.`);
  }
  if (typeof record.root !== "string" || !HASH.test(record.root)) problems.push(`The root isn't a 32-byte hash: ${record.root}`);

  // The leaves.
  const leaves = record.leaves ?? [];
  const seen = new Set<string>();
  let sumLeaves = 0n;
  const amounts: bigint[] = [];
  const paidBy = new Map<string, Record<Kind, bigint>>();
  const fundWallets = new Map<string, Set<string>>();
  leaves.forEach((leaf, i) => {
    const at = `Leaf ${i} (${leaf.account})`;
    if (typeof leaf.account !== "string" || !isAddress(leaf.account, { strict: false }) || leaf.account !== getAddress(leaf.account)) {
      problems.push(`${at}: the account isn't a checksummed address.`);
    } else if (BigInt(leaf.account) === 0n) {
      problems.push(`${at}: the account is the zero address.`);
    }
    const key = String(leaf.account).toLowerCase();
    if (seen.has(key)) problems.push(`${at}: the account has more than one leaf.`);
    seen.add(key);
    const amount = wei(leaf.amount, `${at} amount`);
    if (amount === 0n) problems.push(`${at}: the amount is zero.`);
    amounts.push(amount);
    sumLeaves += amount;
    if (!Array.isArray(leaf.proof) || (leaves.length > 1 && leaf.proof.length === 0) || leaf.proof.some((p) => !HASH.test(p))) {
      problems.push(`${at}: the proof is missing or malformed.`);
    }

    let sumBreakdown = 0n;
    for (const part of leaf.breakdown ?? []) {
      const amountOf = wei(part.amount, `${at} breakdown amount`);
      sumBreakdown += amountOf;
      if (!KINDS.includes(part.kind)) {
        problems.push(`${at}: unknown payout kind "${String(part.kind)}".`);
        continue;
      }
      const club = String(part.club).toLowerCase();
      const line = paidBy.get(club) ?? { holder: 0n, member: 0n, fund: 0n };
      line[part.kind] += amountOf;
      paidBy.set(club, line);
      if (part.kind === "fund") fundWallets.set(club, (fundWallets.get(club) ?? new Set()).add(key));
    }
    if (sumBreakdown !== amount) problems.push(`${at}: pays ${amount} wei but its breakdown adds up to ${sumBreakdown}.`);
  });

  const total = wei(record.total, "The total");
  if (sumLeaves !== total) problems.push(`The total is ${total} wei but the leaves add up to ${sumLeaves}.`);

  // The tree, from the contract's own leaf hashes.
  if (input.leafHashes.length !== leaves.length) {
    problems.push(`Got ${input.leafHashes.length} leaf hashes from the contract for ${leaves.length} leaves.`);
  } else if (leaves.length > 0) {
    const root = merkleRoot(input.leafHashes);
    if (root?.toLowerCase() !== String(record.root).toLowerCase()) {
      problems.push(`The leaves build the root ${root}, not the record's ${record.root}.`);
    }
    leaves.forEach((leaf, i) => {
      if (!Array.isArray(leaf.proof) || leaf.proof.some((p) => !HASH.test(p))) return;
      if (processProof(leaf.proof, input.leafHashes[i]!).toLowerCase() !== String(record.root).toLowerCase()) {
        problems.push(`Leaf ${i} (${leaf.account}): its proof doesn't open against the root.`);
      }
    });
  } else if (total !== 0n) {
    problems.push("The record pays a total with no leaves.");
  }

  // Every Club's books.
  const clubsSeen = new Set<string>();
  let sumPaid = 0n;
  for (const c of record.clubs ?? []) {
    const club = String(c.club).toLowerCase();
    const at = `Club ${club}`;
    if (clubsSeen.has(club)) problems.push(`${at} is listed twice.`);
    clubsSeen.add(club);

    const fees = wei(c.fees, `${at} fees`);
    const sponsored = c.sponsored === undefined ? 0n : wei(c.sponsored, `${at} sponsored`);
    const holderPool = wei(c.holderPool, `${at} Holder pool`);
    const fundPool = wei(c.fundPool, `${at} fund pool`);
    const paidHolders = wei(c.paidHolders, `${at} paid to Holders`);
    const paidMembers = c.paidMembers === undefined ? 0n : wei(c.paidMembers, `${at} paid to members`);
    const paidFund = wei(c.paidFund, `${at} paid to the fund`);
    const carryHolders = wei(c.carry?.holders, `${at} Holder carry`);
    const carryFund = wei(c.carry?.fund, `${at} fund carry`);
    const carried = input.carriedIn.get(club) ?? { holders: 0n, fund: 0n };
    const ledger = input.sponsored.get(club) ?? 0n;

    if (sponsored !== ledger) problems.push(`${at}: the record says ${sponsored} wei sponsored, the sponsors ledger ${ledger}.`);
    const wantHolderPool = (fees * BigInt(PROTOCOL.holderBps)) / 10_000n + carried.holders + ledger;
    const wantFundPool = (fees * BigInt(PROTOCOL.fundBps)) / 10_000n + carried.fund;
    if (holderPool !== wantHolderPool) {
      problems.push(`${at}: the Holder pool is ${holderPool} wei; its fees, carry in (${carried.holders}) and sponsors make ${wantHolderPool}.`);
    }
    if (fundPool !== wantFundPool) {
      problems.push(`${at}: the fund pool is ${fundPool} wei; its fees and carry in (${carried.fund}) make ${wantFundPool}.`);
    }
    if (paidHolders + paidMembers > holderPool) problems.push(`${at}: pays Holders and members ${paidHolders + paidMembers} wei out of a ${holderPool} pool.`);
    if (paidFund > fundPool) problems.push(`${at}: pays the fund ${paidFund} wei out of a ${fundPool} pool.`);
    if (carryHolders !== holderPool - paidHolders - paidMembers) {
      problems.push(`${at}: rolls ${carryHolders} wei of the Holder pool over, but ${holderPool - paidHolders - paidMembers} is left.`);
    }
    if (carryFund !== fundPool - paidFund) problems.push(`${at}: rolls ${carryFund} wei of the fund over, but ${fundPool - paidFund} is left.`);

    const paid = paidBy.get(club) ?? { holder: 0n, member: 0n, fund: 0n };
    if (paid.holder !== paidHolders) problems.push(`${at}: pays Holders ${paidHolders} wei, but its leaves give them ${paid.holder}.`);
    if (paid.member !== paidMembers) problems.push(`${at}: pays members ${paidMembers} wei, but its leaves give them ${paid.member}.`);
    if (paid.fund !== paidFund) problems.push(`${at}: pays the fund ${paidFund} wei, but its leaves give it ${paid.fund}.`);
    const funds = fundWallets.get(club)?.size ?? 0;
    if (funds > 1) problems.push(`${at}: the Club fund goes to ${funds} wallets, not one.`);
    sumPaid += paidHolders + paidMembers + paidFund;
  }
  for (const club of paidBy.keys()) {
    if (!clubsSeen.has(club)) problems.push(`Leaves pay out for ${club}, which isn't one of the epoch's Clubs.`);
  }
  for (const club of input.sponsored.keys()) {
    if (!clubsSeen.has(club) && (input.sponsored.get(club) ?? 0n) > 0n)
      problems.push(`The sponsors ledger has money for ${club}, which isn't one of the epoch's Clubs.`);
  }
  if (sumPaid !== total) problems.push(`The Clubs pay out ${sumPaid} wei in all, but the total is ${total}.`);

  // For the signer's eye.
  notes.push(`${leaves.length} accounts, across ${clubsSeen.size} Clubs.`);
  if (total > 0n && amounts.length > 0) {
    const top = amounts.reduce((a, b) => (b > a ? b : a), 0n);
    notes.push(`The biggest single payout is ${percent(top, total)} of the total.`);
  }
  if (input.previousTotal !== undefined && input.previousTotal !== null) {
    notes.push(
      input.previousTotal === 0n ? "The previous epoch paid nothing." : `The total is ${percent(total, input.previousTotal)} of the previous epoch's.`,
    );
  }

  return { problems, notes, total };
}

/** `part` as a percentage of `whole`, one decimal. */
const percent = (part: bigint, whole: bigint) => `${(Number((part * 1000n) / whole) / 10).toFixed(1)}%`;
