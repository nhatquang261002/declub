# ADR 0023: Signed posts, follows and feed lenses

**Status:** Accepted · 2026-10-05 · Web only: no contract. Part of [ADR 0021](0021-declub-pivot.md). Changes the Board of [ADR 0016](0016-clubs-and-momentum.md). The spec is [09 · Clubs](../09-clubs.md#board-and-moderation).

## Context

A Club's Board lived only in this app's store: the posts were rows a server could change or lose, the order was whatever the app chose, and nothing a member wrote could leave with them. For a community to own what it creates, its conversation has to be the members' own record, readable and checkable outside this app, and the way it is ranked has to be the reader's choice.

## Decision

**Posts and follows are EIP-712 messages signed by the member's wallet, exported in full, and the Board is ordered by a lens the reader picks.**

- **Typed data** (`web/lib/social.ts`): domain `{ name: "DeClub Social", version: "1", chainId }`, with no `verifyingContract`, so no contract accepts these and a post signature can't be mistaken for something one would act on.
  - `Post { address club, string kind, string text, string link, uint64 at }`
  - `Follow { address follower, address target, bool following, uint64 at }`
- **A post is signed by the member's Club wallet,** the one the Members list shows, so the record names who wrote it and reveals no other linked wallet. The server checks the signature (locally for a plain wallet, through ERC-1271 for a smart one), that `at` is within 5 minutes of its clock, that the text and link are exactly what it would store (cleaned, canonical), and every Board rule as before. The post's id is its struct hash, so the same signed post is the same post.
- **Only signed posts are accepted** by `POST /api/clubs/<token>/posts`. Moderation is unchanged: hiding, deleting, reports and bans work as before.
- **Follows are per wallet,** signed by one of the caller's linked wallets, newest record wins (an unfollow signed later undoes a follow).
- **Export:** `GET /api/clubs/<token>/feed` (a Club's signed posts), `GET /api/wallets/<wallet>/posts` (a wallet's across Clubs), `GET /api/wallets/<wallet>/follows` (its follows and follower count). Each answer carries the domain and types to verify against. A post hidden by moderation is left out of the exports until it's restored, so the export can't re-publish what reports or a moderator took down.
- **Lenses** (`web/lib/lenses.ts`): a lens is a pure function `rank(posts, { now, follows, holders, momentum })`. Built in: **Newest**; **Top traders** (author Momentum × recency, 24-hour half-life); **Holders** (authors who hold the asset); **Following** (wallets the reader follows). Pinned posts stay on top except under Following. `GET …/posts?lens=…&as=<reader's wallet>`. Every input a lens uses is public, so another app can rank the same posts its own way.

## What it does not do

- **It doesn't put posts on chain.** They live in the store and the exports; the signature makes them verifiable, not permanent. Losing the store still loses them, unless someone kept the export.
- **It doesn't let a hidden or deleted post live on here.** Moderation takes it out of this app and its exports. Whoever already fetched the signed record still has it; that is the point of signing.
- **It isn't a protocol.** There is no relay, no replication and no registry of third-party lenses yet; the export and the lens interface are what make those possible.

## Consequences

- **One wallet prompt per post and per follow.** Signing costs no gas. A member whose connected wallet isn't their Club wallet is asked to switch before signing.
- **Posts made before this change** (unsigned, 32-hex ids) still read and moderate as before; they aren't exported. The store started empty with ADR 0021, so on testnet there are none.
- **New store keys:** the per-wallet post index, the follow sets and one record per follow pair.
