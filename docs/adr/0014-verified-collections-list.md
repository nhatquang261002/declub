# ADR 0014: A curated list marks which collections and tokens are verified

**Status:** Accepted · 2026-10-02 (the list file) · 2026-10-08 (the badges and warnings, and lookalikes, below) · Web only. No contract, matcher or pool change. Builds on [ADR 0005](0005-generic-asset-model.md). [ADR 0016](0016-clubs-and-momentum.md) opens a Club for each verified collection and memecoin.

## Context

On mainnet the app should trade any ERC-721 and ERC-20, not only Chogs. The contracts already do: `OnDealV2` has no allowlist and never trusts a token beyond its own balances, so a bad token can only hurt trades that name it ([ADR 0005](0005-generic-asset-model.md)).

What a user can't see is whether a contract is the real one. A contract can claim any name and symbol, and a clone of a popular collection looks the same in a picker. The signal has to come from somewhere other than the contract, and it can't live in the contracts, which have no admin and shouldn't get one.

## Decision

**A list the maintainer curates, shipped with the web app, marks assets as verified or blocked. It only changes what the UI shows.**

- **One file in the repo**, `web/data/assets.json`, reviewed and changed by pull request. Each entry has the chain id, the checksummed address, the kind (`erc721` or `erc20`), for an ERC-20 a `category` (`memecoin`, `stablecoin`, `wrapped` or `other`), a name and symbol for display, a `status` (`verified` or `blocked`), and a short `note` saying why. It is bundled into the build, so no server, store or env var is involved.
- **Three tiers:**
  - **Verified:** a badge in pickers, asset rows, deal cards and the review step. Verified collections are the ones the NFT picker offers first (this replaces `NEXT_PUBLIC_KNOWN_COLLECTIONS`, which stays as a development override).
  - **Unverified** (the default, anything not on the list): tradable, with the full address always shown, a plain warning, and one extra confirm in the create and fill steps.
  - **Blocked:** hidden from pickers and lists, refused by the asset editor, and shown with a banner if someone opens a deal that includes it by link.
- **Never in the way of getting assets back.** Cancel, reclaim, withdraw and `claim` work the same for every tier, and a deal that already holds a blocked token still opens, so its owner can see and unwind it.
- **Matched by chain id and address, never by name or symbol.** An entry says nothing about any one token in a collection, only about the contract. Testnet and mainnet entries never mix.
- **Lookalikes are flagged, never trusted.** An unverified contract whose name or symbol reads the same as a verified one's (case, accents, spacing, punctuation, Cyrillic or Greek letters and digits like `0` for `o` folded away) gets a **Lookalike** chip and a warning naming the real contract. The name only ever adds a warning: it can't make anything verified.
- **Where the extra confirm sits.** It guards what a person *receives*: a taker accepting a deal, and a maker accepting an offer on an open offer. Ticking "I've checked these contract addresses" unlocks **Approve** and **Accept & swap**. A blocked asset on either side of a deal stops both; Create and the offer form refuse it outright. Built in `web/lib/assetTrust.ts`, `web/components/TrustChip.tsx` and `web/components/TrustCheck.tsx`.
- **What "verified" means** is written down in the docs and applied by the maintainer. A starting bar: the address comes from the project's own official channel; the source is verified on Sourcify or the chain's explorer; an ERC-721 reports the interface, and an ERC-20 passes the escrow's exact-transfer check (no fee-on-transfer, no rebasing). A wrong "verified" is worse than none, so when in doubt an asset stays unverified.

## What it does not do

- **It doesn't restrict trading.** Any address can still be traded, verified or not. There is no allowlist in the contracts, the matcher or the pool.
- **It isn't a safety guarantee.** It says "this is the contract the project published", not "this asset is safe or valuable". The copy has to say that.
- **No automatic sources.** Marketplace verification, token lists and similar can be added later as extra signals. They aren't part of this decision.

## Consequences

- The maintainer owns this list, and it can mislead people if it's neglected or wrong. It needs a delisting process that can act quickly on a scam, and a rule for who may merge changes.
- A change ships with a web deploy. If that proves too slow for blocking scams, serve the same JSON from an endpoint without changing the format.
- A small test should check the file: addresses checksummed and unique per chain, a known kind and status, no empty note.
- The off-chain pool could reuse the blocked entries to refuse junk intents ([ADR 0008](0008-trade-intents.md)). That is separate and not decided here.
- Still open, and not covered by this ADR: ERC-1155 support and collections without enumeration. The protocol fee doesn't depend on which assets are traded: it is flat per side ([ADR 0015](0015-protocol-fee.md)).
