# ADR 0022: Club Rewards — a share of the fees goes back to the Club

**Status:** Accepted · 2026-10-05 · New contract `DeClubRewards`, an epoch builder in the web server, and Rewards screens. Part of [ADR 0021](0021-declub-pivot.md). The spec is [09 · Clubs](../09-clubs.md#rewards). Amended by [ADR 0024](0024-x-posts-and-the-holder-bonus.md): Holders' shares now count up to 50% more for their activity in the epoch, including their X posts. Amended by [ADR 0025](0025-clubs-are-for-nft-collections.md): shares are one per NFT only; a Club's memecoin earns no shares.

## Context

Every completed swap pays a flat protocol fee per side ([ADR 0015](0015-protocol-fee.md), [0018](0018-adjustable-protocol-fee.md)) to one recipient. The Clubs whose assets are traded get nothing from it, though their members create the market. We want the people who hold and trade an asset to share in the fees its market pays, in a way that can't be farmed and that anyone can check.

Constraints:

- **The deal contracts stay as they are.** They are tested to invariants and a Halmos proof; a fee splitter inside them would reopen all of it.
- **Anything that pays people gets gamed.** A payout must cost more to fake than it returns.
- **Club membership lives in the server's store**, not on chain (ADR 0016).

## Decision

**Each epoch, the server splits each Club's share of the fees between its Holders and its Owner, publishes a Merkle root, and the operator funds it on `DeClubRewards`, where members claim.**

- **The split, per Club:** of the fees its completed swaps paid in the epoch, **50%** to its Holders, **25%** to the Club fund, **25%** stays with the protocol (`REWARDS` in `web/lib/rewards.ts`; 40% / 20% / 40% until 2026-10-06). A swap naming two Clubs' assets splits its fee evenly between them.
- **Holders are paid by holdings,** read fresh when the epoch is built: one share per NFT of the collection, and one per `minHolding` (or whole token) of the memecoin, summed over the member's linked wallets. Only joined members are paid; a member is paid at their Club wallet. Splitting one's NFTs across accounts earns nothing extra.
- **The Club fund goes to the Owner** (ADR 0016's claimed or assigned Owner), at their Club wallet.
- **What can't be paid rolls over:** a Club with no Holder members, a Club with no Owner, and rounding dust carry into its next epoch.
- **Epochs are a week** (`NEXT_PUBLIC_REWARDS_EPOCH_SECONDS`, shorter for a demo), counted from `NEXT_PUBLIC_REWARDS_GENESIS`, built in order and once each (`web/lib/server/rewards.ts`).
- **The fee of each swap** comes from its receipt: `FeeCharged` beside an escrow fill, recorded with the Club's activity; for a signed swap, the settlement's `FeeCharged`, read when the epoch is built.
- **One Merkle leaf per account per epoch,** summing every Club it earned in, bound to the chain and the contract and hashed twice: `keccak256(bytes.concat(keccak256(abi.encode(chainid, rewards, epoch, account, amount))))`.
- **`DeClubRewards`:** the operator `publish`es a root with the MON it covers; claims open after `CLAIM_DELAY` (a day on mainnet), during which the operator can `revoke` a wrong root and take the MON back; anyone can `claim` a leaf for its account; after `CLAIM_WINDOW` (90 days) the operator can `sweep` what's left to roll it forward. Each epoch keeps its own books: it can never pay out more than it was funded with, and no leaf is paid twice.
- **Funding is manual:** the operator (the fee recipient's side) sends each epoch's total with `publish`. Fees from signed swaps are WMON and are unwrapped first; rewards are paid in MON.
- **Everything is public:** `GET /api/rewards/epochs/<n>` serves the epoch with every leaf and proof, so anyone can rebuild the root.

## What it does not do

- **It doesn't make the payout trustless.** The operator builds the root from the server's data (memberships live in the store) and could publish a wrong one. The claim delay, the public epoch data and the per-epoch cap bound the damage; they don't remove the trust.
- **It doesn't reward posting or attention directly.** Posts weigh nothing, as in Momentum. Rewards follow holdings, which cost something to have.
- **It doesn't snapshot at a fixed block.** Holdings are read when the operator builds the epoch, at a time nobody announces. Someone could borrow NFTs around that moment; the rewards at stake are a fraction of fees, which bounds the incentive.
- **It doesn't change any deal.** The fee is charged exactly as before; what happens afterwards is new.

## Consequences

- **Faking volume loses money.** Each side of a swap pays the whole fee; at most 75% of it comes back, shared with every other Holder of the Club.
- **A new trusted role,** the rewards operator, separate from the fee admin. On mainnet it is a Safe (`DeployRewards.s.sol` refuses an EOA there).
- **The operator has a weekly job:** run `npm run rewards:epoch -- --publish` (or build, then publish from the Safe). An epoch that is built but never published rolls nothing over and pays nothing until it is.
- **The activity log carries fees now** (`ActivityEvent.fee`), and the store holds epochs, per-account indexes and per-Club carry.
