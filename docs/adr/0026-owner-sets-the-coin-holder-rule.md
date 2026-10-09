# ADR 0026: The Owner sets the coin-holder rule

**Status:** Accepted · 2026-10-06 · Web only: no contract change. Amends [ADR 0025](0025-clubs-are-for-nft-collections.md) (holding a Club's memecoin makes a Holder, from `minHolding`). The spec is [09 · Clubs](../09-clubs.md#which-assets-get-a-club).

## Context

Since [ADR 0025](0025-clubs-are-for-nft-collections.md), a memecoin lives in its collection's Club. Holding it earns the Holder badge, from `minHolding` in `web/data/assets.json`, but no Club Rewards shares. Whether the coin should make a Holder at all, and from how much, is the community's call, not the maintainer's. A pull request per change is the wrong tool for it, and one fixed threshold can't fit every coin.

## Decision

**The Club's Owner decides whether holding its memecoin earns the Holder badge, and from what minimum. NFTs always do.**

- **The setting:** `coinHolders` in the Club profile: `on`, `min` (base units, a decimal string) and `at` (epoch ms when it last changed). Owners and app admins set it in **Manage → `<COIN>` holders**, typing the minimum in whole coins (converted with the token's own `decimals`). It goes through `PATCH /api/clubs/[token]/profile` as `{ coinHolders: { on, min? } }`; without `min`, the current minimum stays. A Club without a memecoin refuses it.
- **Until the Owner sets it,** the coin counts from `minHolding`, or any balance without one, as before. `assets.json` keeps `minHolding` as that default.
- **Turning it off** means only the collection's NFTs earn the badge. The coin's balance isn't even read.
- **A change re-checks badges:** a row checked before `at` is out of date, like one older than a day, and the Members list re-reads it (at most 50 per read). Saving the same rule again doesn't move `at`.
- **Shown to everyone:** the profile serves `coin: { token, symbol, on, min, set }` (null without a coin). The Club's **Contract details** block says which holdings earn the badge.

## What it does not do

- **It doesn't touch Club Rewards.** Shares stay one per NFT ([ADR 0025](0025-clubs-are-for-nft-collections.md)), whatever the rule.
- **It doesn't re-check every badge at once.** Badges catch up as the Members list is read. Until then, a badge from the old rule can still let someone post where only Holders may, or count an X share, for up to a day.
- **It doesn't let the Owner rule on the NFT.** One NFT is always enough.

## Consequences

- **The Owner's choice changes who counts in Holder-only posting,** the Holders lens and X shares, all of which read the badge.
- **Changes are logged** as `edit_profile` with `coinHolders` in the detail.
- **`isHolder` takes the rule** (`coinRule` in `web/lib/members.ts`), and `staleRows` takes the time it changed.
