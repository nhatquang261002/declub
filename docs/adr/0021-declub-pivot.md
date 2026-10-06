# ADR 0021: De(al) Club — Clubs are the product, swaps fund them

**Status:** Accepted · 2026-10-05 · Renames the project and its contracts, deletes the v1 escrow. Builds on [ADR 0016](0016-clubs-and-momentum.md); the features it calls for are [ADR 0022](0022-club-rewards.md) (Club Rewards) and [ADR 0023](0023-signed-posts-and-lenses.md) (signed posts, follows and lenses).

## Context

On Deal was an OTC swap app with Clubs added later: a community page per verified collection or memecoin, with a market, a board and an activity score. We are entering a Monad hackathon track on social and cultural ownership, whose question is how participation in a community turns into ownership and economic stake for the people generating it. The app as it stood answered "how do two strangers swap safely", not that.

Two things already pointed the other way. Clubs had the parts a community needs (members, verified profiles, roles, moderation, receipt-verified activity), and every completed swap paid a protocol fee to a single recipient. The value the community created went one way.

## Decision

**Clubs become the product. Swaps are the economy inside them, and part of what they pay goes back to the Club.**

- **Rename.** The project is **De(al) Club**: the wordmark in the logo, the home hero and the page title. Everywhere else, in body copy, code, contracts, URLs, env vars and store keys, it is **DeClub**. The parentheses read it both as "Deal Club" and "De Club".
- **Contracts renamed and redeployed.** `OnDealV2` → `DeClubEscrow`, `OnDealIntents` → `DeClubIntents` with the EIP-712 domain `("DeClubIntents", "1")`, interfaces and tests with them. `FeeAdmin` keeps its name. The behaviour doesn't change. A new `DeClubRewards` joins them (ADR 0022).
- **Delete the v1 escrow.** `OnDeal` (Chog only, no fee, not used by the app since ADR 0020) and its tests go. Git history keeps them. `MockChog` and `ChogGenesisMirror` stay, deployed by `DeployChog.s.sol`.
- **Every identifier moves.** `NEXT_PUBLIC_ON_DEAL_*` → `NEXT_PUBLIC_DECLUB_*`, the store prefix `ondeal:` → `declub:`, the ABIs `deClubEscrowAbi` / `deClubIntentsAbi`. The store starts empty: it held testnet data only.
- **The app leads with Clubs.** The home page, the nav (Clubs first), the Clubs guide and the docs tell the Club story; deals stay where they were.

## What it does not do

- **It doesn't change how a deal settles.** Escrow, signed swaps, rings, the fee and the fee admin work as before.
- **It doesn't rewrite history.** ADRs 0001–0020 keep the names they were written with. The broadcast records stay under the scripts' old names (`Deploy.s.sol`, `DeployV2.s.sol`).

## Consequences

- **Testnet must be redeployed.** Nothing deployed runs under the new names. The escrow's ABI didn't change, so locked deals still work against the old `OnDealV2` deployment; the old intents contract signs with the old domain, so signed swaps against it fail with the new app until `DeClubIntents` is deployed.
- **Store data is dropped.** Memberships, posts and the activity log start over under `declub:`. On testnet that's acceptable; there was no production data.
- **One fewer contract to audit.** v1's tests (about 80) leave the suite with it.
