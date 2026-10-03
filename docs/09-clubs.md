# 09 · Clubs and Momentum

A **Club** is the community for one verified NFT collection or ERC-20 token. Signed-in users join it, and it shows the deals that use the asset, a board of short posts, its members, and **Momentum**, an activity score. The decision and its reasoning are in [ADR 0016](adr/0016-clubs-and-momentum.md). This page is the spec.

## What a Club gives you

- **Market:** the open deals and signed swaps that offer or want the asset, and a strip of recently completed ones.
- **Board:** short posts from members: notes, and "Looking for" posts that can link a deal.
- **Members:** a leaderboard ranked by member Momentum, with verified X or Discord handles ([ADR 0011](adr/0011-verified-profiles.md)) and a Holder badge.
- **Momentum:** how alive the asset's trading is, for the Club, and how much each member has contributed.

Clubs change nothing on chain. No contract, matcher rule or pool rule depends on a Club.

## Routes

| Route | What |
|---|---|
| `/clubs` | Index: "Your clubs", then every Club sorted by Club Momentum |
| `/clubs/[address]` | One Club, with the tabs Market, Board and Members |

"Clubs" is added to the header's nav.

## Which assets get a Club

Only NFT collections and memecoins marked `verified` in `web/data/assets.json` ([ADR 0014](adr/0014-verified-collections-list.md)). A cloned collection can't get a Club, and moderation stays bounded. A `blocked` entry never has a visible Club.

Verified isn't the same as having a community. Every ERC-20 entry has a `category`: `memecoin`, `stablecoin`, `wrapped` (WMON) or `other`, and only a memecoin gets a Club. Mock USD is verified, so its deals are trusted, and has none. Setting `club` on a token that can't have one fails the build.

**A memecoin and its collection share one Club.** The joining entry's `club` is the other's address:

```json
{ "address": "0x…CHOG token", "kind": "erc20", "category": "memecoin", "club": "0x…Chogs collection", … }
```

- Everything the Club keeps (members, posts, roles, bans, the activity log) is under the address of the asset that has the Club. `/clubs/<either address>` opens it (the other redirects), and every route takes either.
- A deal in either asset counts toward the Club's Momentum, once even when it names both. Its Market lists offers and requests for both, and a "Looking for" post can link a deal in either.
- Holding either earns the Holder badge (the NFT, or `minHolding` of the coin). The Owner is claimed with the `owner()` of the Club's own asset.
- One collection and one memecoin at most: two of a kind, a third asset, a chain of joins, or a Club that is off, unlisted or on another chain fails the build (`makeRegistry`).

### Lifecycle

| Step | How |
|---|---|
| **Create** | Add a `verified` collection or memecoin, merge it, deploy the web app. No contract deploy. Club data lives in the store, so it survives web deploys. `club: false` keeps an entry verified without opening a Club; `club: "<address>"` joins another's. |
| **Archive** | Set `club: "archived"`. The Club becomes read-only: no joins, no posts, board frozen. Members, posts and history are kept, and its deals still show. An Owner asks, the maintainer merges. |
| **Hide** | Turn the entry to `blocked`. The Club is hidden on the next deploy. Its data stays in the store, unseen. |
| **Purge** | An app admin calls `DELETE /api/clubs/[token]` on a hidden Club to delete its stored data. Nothing is purged automatically. |
| **Later** | The list moves to an endpoint or the store, with an in-app request and approval queue. The format and the Club data model stay the same. |

## Roles

Kept per Club, by Privy user id, in `club-roles:{chain}:{token}`. The app admin isn't stored there: it comes from `CLUB_ADMIN_USER_IDS` and outranks any Club role (an admin gets no Club role to give or take). People are named by their Club wallet in the screens and the API, never by user id.

| Role | How you get it | Can |
|---|---|---|
| **App admin** | `CLUB_ADMIN_USER_IDS` environment variable | Everything below, in every Club. Assign or remove Owners. Ban someone from every Club. Purge a hidden Club. |
| **Owner** (at most one) | **Claim:** a member whose linked wallet is the contract's `owner()`, read on chain by the server. **Or** an admin assigns one after checking the project another way. | Edit the Club profile: description (500 characters), up to 3 links, banner (a token image). Pin up to 3 posts. Appoint and remove Moderators (at most 10). Hand ownership to another member. Set "holders only can post". |
| **Moderator** | Appointed by the Owner or an admin | Hide, restore and delete posts. Work through the report queue. Ban and unban members from this Club. Can't act on the Owner or on other Moderators. |
| **Member** | Joins | Post (needs a shared verified profile), report posts, appear on the leaderboard. |
| **Visitor** | Not joined, or not signed in | Read only. |

Rules:

- **Holder is a badge, not a role.** Holding grants no permissions, except where the Owner turns on "holders only can post".
- **No role touches Momentum.** It comes only from receipt-verified activity.
- **Everything is logged.** Every role change and moderation action goes to `club-log:{chain}:{token}` as `{actor, action, target, at}`, capped at 1000. The Owner, Moderators and admins can read it.
- **The Owner can't leave** without handing ownership over first. Leaving or being banned removes any role. Only an admin can ban the Owner.
- **A claim is checked once,** when it is made. If `owner()` later changes, admins see "ownership changed on-chain" and decide what happens.

## Screens

**Home page** (`#clubs`): what a Club is (Market, Board, Members), the three Momentum rules with their weights, the heat scale, and the three busiest Clubs. The explaining lives here so `/clubs` can be all directory.

**`/clubs`**

- Totals: Clubs, active Clubs, members, completed swaps this week. A "Your Clubs" row when signed in.
- **Most active right now:** the top three Clubs by Momentum, as cards (cover, avatar, rank, heat, Momentum and its change, members, swaps in 7 days, last activity). Only Clubs with some Momentum; otherwise a note that it's quiet.
- **Rising this week** (largest weekly gain) and **Most traded · 7 days** (completed swaps), five each.
- **All Clubs:** search (name, symbol, address, of either asset of a paired Club), Collections / Memecoins (a paired Club is in both), and sorts: busiest, rising, most traded, most members, recently active, A–Z. A list view by default (rank, Club, heat, Momentum, members, swaps in 7 days, last active), or cards; the choice is remembered per browser. Twelve at a time with "Show more". Archived Clubs go last.
- The directory draws from the assets list at once; the numbers fill in from the server, and are left out, with a note, if it can't be reached.

**`/clubs/[address]` header**

- A cover in one of the brand colours, picked from the address. The avatar is the asset's `image` from the assets list (a path under `web/public`), or its initials until it has one.
- Name, symbol, kind, a Verified chip (its tooltip is the list's note), when it was last active, an Archived chip, the description and links.
- Join / Leave. Signed out it offers "Sign in to join"; without sign-in or a store it shows nothing and the Club is read-only. A member sees a Holder badge when they hold the asset, and Leave in the "⋯" menu beside it. Under Join: "Shows your wallet on the Members list."
- Stats: Momentum and its trend (with an explanation) · members and holders · swaps in 7 days · new deals in 7 days · traders in 30 days · heat.
- A side column: the heat scale (Quiet, Stirring, Active, Busy, Hot) with this Club's step marked, the top five traders, and the contract, kind and why it is verified.
- The open tab is in the URL, `?tab=market|board|members|manage`.

**Market tab**

- **Have:** open deals and signed swaps that offer the asset, open offers included.
- **Wanted:** open deals and signed swaps that ask for it, trait requests for the collection included.
- **Completed:** the Club's latest completed swaps, with who traded and a link to the deal (or, for a signed swap, its transaction).
- Only live ones: open and not expired. Built from the existing cards, `ListingGrid` and `DealCardV2`.
- Says when more than 50 locked deals name the asset ("showing the newest 50 deals; browse Deals and search to see the rest") and when the signed-swap pool isn't answering.

**Board tab**: member posts, newest first, pinned ones on top.

- *Note*: plain text, 280 characters at most.
- *Looking for*: text, plus an optional deal id or intent hash, shown as its card. For example "WTB any Chog with a crown, 2 MON over floor".

**Members tab**: the leaderboard. Each row shows `<Who>`, the Holder badge, join date and completed trades in this asset. A "Newest" sort is also available.

**Deep links**: an asset row on a deal page links to its Club when it has one.

## Momentum

Pure functions in `web/lib/momentum.ts`, computed from the Club's activity log over the last 30 days with a 7-day half-life. An event weighs `w × 0.5^(age / 7 days)`.

| Event | Weight | Why |
|---|---|---|
| Completed swap containing the asset (V2 fill, accepted proposal, settled intent) | 10 per side | Each side pays the flat protocol fee ([ADR 0015](adr/0015-protocol-fee.md)), so faking it costs real money |
| New deal, open offer or intent naming the asset | 2, at most 3 per wallet per day | Cheap to make, so capped |
| Board post | 0 | Engagement isn't trading, and giving posts no weight means spam doesn't pay |

- **Club Momentum** = decayed sum × `(1 + log2(unique wallets in 30 days)) / 4`. Breadth counts, so one wallet trading with itself barely moves it. The trend compares it with the same score as of 7 days ago.
- **Member Momentum** = the decayed weights of events where one of the member's linked wallets is a party. A completed swap with a counterparty already traded with in this Club in the last 7 days counts half (wash damping).
- All constants live in one exported object, so they can be tuned without touching logic.
- Results are cached per Club in the store for 60 seconds.

What Momentum doesn't say: that a Club is good, that its asset is safe, or that a member is honest. It says "this market has been busy". A well-funded actor can still inflate it, at the protocol fee on every side plus gas.

## Where the activity comes from

There is no indexer, and the public RPC caps `eth_getLogs` at 100 blocks ([ADR 0003](adr/0003-no-indexer-in-v1.md), [0004](adr/0004-read-deals-from-storage.md)). `OnDealV2` stores no creation or fill time either. So the log is built from **receipts the server verifies itself**, the way `ingestFills` already works ([ADR 0012](adr/0012-server-side-saves.md)).

- **`ingestTx(store, hash)`** in `web/lib/server/activity.ts` fetches the receipt and decodes it (`recordActivity` is the part after the receipt is in hand). Each event becomes `{id, kind, contract, deal, block, at, parties[], tokens[]}`, with `id` = `txHash:logIndex`, so a replay is the same event. It goes into the log of every Club it names, once per Club, under the Club's own asset; an event that names no Club asset is dropped, so the log can't grow unbounded.
  - `OnDealV2` only: `TradeCreated` is a `created` event; `TradeFilled` is a `swapped` one. The deal's assets come from `getTrade`, plus the proposal's assets when the same receipt holds the `ProposalAccepted` that filled it. A swap's parties are the maker and the taker. Native MON never counts as a token. A reverted transaction records nothing.
  - The log is one sorted set per Club, scored by block time, whose members are the events as JSON. Trimming at 5000 therefore leaves nothing behind, and storing the same event twice is a no-op.
- **`POST /api/activity {hash}`** reads the receipt once and feeds both History (`recordFills`, the part of `ingestFills` after the receipt) and the Club log. `POST /api/fills` stays for older clients.
- **Client:** `web/lib/fillReport.ts` has `mayFill` (a fill: awaited, History needs it before it refetches), `mayReport` (a fill, or a V2 `createTrade`, `createTraitTrade` or `createOpenOffer`: fire-and-forget) and `reportTx`. Accepting a proposal is a fill.
- **Signed swaps** are not in `ingestTx`, and are not copied into the store. The Club routes read the matcher's `/settlements?token=` when asked (cached 30 s per Club in the server process) and merge it with the log by event id. A settled cycle is one swap with every maker in it as a party. A pool that is down only costs the signed swaps. This needs no cursor, and it relies on the matcher keeping its history.
- **OnDeal (v1)** isn't logged: it is Chog-only and superseded by V2.
- **A Club added later has no past:** only events recorded while its asset was on the list count, until the fill watcher backfills it ([ADR 0019](adr/0019-fill-watcher.md), `FILL_WATCHER_START_BLOCK`).
- **Matcher:** `GET /intents` and `/settlements` take `?token=`: any intent naming that address on either side, whatever the id (it matches the address inside the `intent_assets` key, so there is no schema change). `/settlements` also takes `?after=` (milliseconds; later cycles only, oldest first) for a reader that pages forward. `web/lib/pool.ts` passes `token`.
- **Deals feed** comes from the server's deal book ([ADR 0020](adr/0020-server-side-deal-book.md)): `useClubMarket` asks `/api/deals` for the open locked deals that name the Club's assets, across every deal, and `offersToken` / `requestsToken` in `lib/dealFiltersV2.ts` split them into For trade and Wanted.
- **Deals made outside the app** come in through the fill watcher ([ADR 0019](adr/0019-fill-watcher.md)): a cron that follows the finalized head from a cursor and passes each transaction through `recordActivity`, so they count within a run's interval.

## Membership and the Holder badge

- **Join:** needs sign-in and at least one linked wallet (422 `no_wallet` otherwise). The member row snapshots `linkedEthereumWallets(user.linked_accounts)` (`web/lib/profiles.ts`), never anything from the request. The display wallet, the one the Members list shows, is the first with a shared profile, else the first. Joining twice is the same as once; an archived Club refuses (409 `archived`); a Club stops at 2,000 members (409 `full`). **Joining publishes the display wallet**, so the button says so.
- **Holder:** ERC-721 `balanceOf ≥ 1` across the member's wallets, or ERC-20 `balanceOf ≥ minHolding` (an optional `assets.json` field); in a paired Club, either. If one asset can't be read and the other doesn't make the member a Holder, the old badge stays. Checked on join, then rechecked when the row is over 24 hours old and the members list is read: one `multicall` per member, at most 50 members per read (oldest check first), so the badge is at most a day old. A read that fails keeps the old badge and tries again next time. Without `minHolding`, an ERC-20 Holder holds any amount.
- **Wallets kept in step:** the Privy webhook handler, the profile route (share or stop sharing) and every signed-in `GET .../membership` re-sync `wallets[]` and the display wallet in every Club the user belongs to (`syncMemberships`). New wallets reset the balance check. Unlinking a wallet drops its Momentum from that member. **A user left with no linked wallet (or deleted) leaves every Club,** since there is nothing to show or score; joining again takes a wallet.
- **Leave** deletes the row and the set entries, and any role with it. The Owner can't leave without handing the Club over (409 `owner_cannot_leave`).
- **Public list:** `GET .../members` never includes a user id. A member is their display wallet, with holder flag, join date, Momentum and completed swaps (events the log and pool know of, where one of their wallets was a party). It shows the first 100 of the sort and counts everyone.

## Board and moderation

This is the first user-written content in the app.

- **Who can post:** members with a **shared verified profile** (ADR 0011), not banned in that Club, in a Club that isn't archived. If "holders only can post" is on, holders only, except the Owner, Moderators and admins. The post shows the member's Club wallet.
- **Text:** at most 280 characters (counted as characters, so an emoji is one). Control characters, line breaks, zero-width and bidirectional-override characters become spaces, runs of spaces collapse, the ends are trimmed. It is shown as plain text: React escapes it, there is no markdown, and URLs aren't linked.
- **Links:** only a "Looking for" post can carry one, a deal id or a signed-swap hash. The server checks that it exists and names the Club's token (`link_not_found`, `link_mismatch`; `link_unavailable` when the lookup itself fails).
- **Rate limits** (`withinLimit`), applied after the checks above so a post the server refuses doesn't use one up: a 30-second cooldown and 5 posts an hour, per user per Club; 20 reports a day per user.
- **Reports:** a member can report a post once (a set per post, so the same member twice adds nothing) and not their own. At 3 distinct reports it is hidden and unpinned: others see "hidden after reports", the author still sees it, and staff see it with the report count. Hidden-by-reports is logged as `auto_hide`.
- **Moderators and above** hide and restore posts (restoring clears the reports, so old reports don't re-hide it), delete posts, and ban, all subject to the permission matrix above. Hiding or deleting a post unpins it. **Authors** can delete their own posts, which isn't logged.
- **Bans:** by wallet (a member) or by post (that post's author, which reaches a spammer who already left). A banned user leaves the Club, loses any role, and can't rejoin or post. Only an admin can ban the Owner, or ban everywhere (which removes the user from every Club). Lifting a ban doesn't put anyone back. Nobody can ban themselves.
- **Archived Clubs** refuse joining, posting and reporting. Staff can still delete, hide and ban, and the Owner can still pin.
- **The Owner's claim:** `POST .../claim` reads the token's `owner()` on chain. If one of the caller's linked wallets is it, they become Owner and the claim is recorded. A second claimant gets `has_owner` (an admin decides); a token with no `owner()` gets `no_owner`. An admin reading the log is also told when `owner()` no longer matches the claim.
- **Club page:** the Owner or an admin edits a description (500 characters), up to 3 `https://` links (they become anchors with `rel="noopener noreferrer nofollow"`, so nothing else is accepted) and "holders only can post". **A banner image is not built yet.**
- **The log:** every role change, ban, hide, restore, staff delete, pin, claim and profile edit, as wallets rather than user ids, newest first, capped at 1000. Staff read it.

## Data (Upstash)

All keys start with `ondeal:` and are per chain.

| Key | Holds |
|---|---|
| `club:{chain}:{token}:members` | set of userIds (the join date is on the row; bounded at 2,000 so a read of every row stays one call) |
| `club-member:{chain}:{token}:{userId}` | `{wallets[], displayWallet, holder, holderCheckedAt, joinedAt}` |
| `user-clubs:{userId}` | set of tokens |
| `activity:{chain}:{token}` | zset: event JSON → block time, capped at 5000 |
| `club-posts:{chain}:{token}` | zset: postId → time, capped at 500 |
| `club-post:{chain}:{token}:{id}` | `{id, userId, wallet, kind, text, link?, at, hidden?}` (never sent as it is) |
| `club-reports:{chain}:{token}:{id}` | set of the userIds that reported the post |
| `club-ban:{chain}:{token}` / `club-ban:all` | `{userId: {wallet, at, by}}`, one document each |
| `club-roles:{chain}:{token}` | `{owner?, moderators[]}`: user ids, one small document rewritten whole (staff-only, rare) |
| `club-profile:{chain}:{token}` | `{description, links[], holdersOnlyPosts, pinned[], ownerClaim?}` (a banner is not built yet) |
| `club-log:{chain}:{token}` | zset of log lines as JSON, scored by time (made strictly increasing), capped at 1000 |
| `momentum:{chain}:{token}` | cache |

The store needed only three new operations over the whole feature (set add, remove and count). The activity log, the post ranking and the moderation log use the existing `rank` and `ranked`; roles, profile and bans are single documents. So a deleted post stays in the ranking until it falls off, and reads skip it; the cap of 500 includes such ids.

The store comment says it holds only cosmetic or rebuildable data. Memberships and posts are the first data that can't be rebuilt from the chain, and the comment changes with them. **Losing the store loses them.**

## API

Each route is a thin wrapper over a function in `web/lib/server/clubs.ts` that takes the store as a parameter, like `syncProfile` and `handlePrivyEvent`, so the logic can be tested without a server. Without a store or Privy, every route returns `{enabled:false}`, and the UI shows a "not configured" panel like the Account page's.

| Route | What |
|---|---|
| `GET /api/clubs` | `{logging, clubs}`: each Club's info, stats and `members`, busiest first (public, cached 30 s). `logging` is false when this server keeps no activity log, and then only signed swaps count. Built. |
| `GET /api/clubs/[token]` | `{logging, club, recent, holders}`: the Club's info, stats, member and holder counts and its latest 20 completed swaps. 400 for a bad address, 404 for an asset with no Club (blocked, unlisted, `club: false`, or a token that isn't a memecoin). A paired asset's address serves its Club. Archived Clubs are served. Built. |
| `GET /api/clubs/[token]/members?sort=momentum\|new` | `{enabled, members, total, holders}` (public, cached 15 s). 400 for another `sort`. Built. |
| `GET` / `POST` / `DELETE /api/clubs/[token]/membership` | Your membership `{member, wallet?, holder?, joinedAt?, role}` / join / leave (gated). A `GET` also re-syncs your wallets. Built. |
| `GET /api/me/clubs` | `{clubs}`: the Clubs you belong to, leaving out ones that no longer exist (gated). Built. |
| `GET /api/clubs/[token]/posts` | `{enabled, posts, role}`: pinned first, then newest; hidden posts redacted. Public and cacheable for readers without a token; a reader who sends one gets a private answer that includes their own hidden posts (and, for staff, all of them with report counts). Built. |
| `POST /api/clubs/[token]/posts` | `{kind: "note"\|"looking", text, link?}` (gated; 201). Built. |
| `DELETE /api/clubs/[token]/posts/[id]` | Author, or staff who may act on the author. Built. |
| `POST /api/clubs/[token]/posts/[id]/report` | Report (gated). Built. |
| `POST /api/clubs/[token]/posts/[id]/hide` | `{hidden}`: hide or restore (staff). Built. |
| `POST /api/clubs/[token]/posts/[id]/pin` | `{pinned}`: pin or unpin (Owner or admin; at most 3). Built. |
| `GET` / `POST` / `DELETE /api/clubs/[token]/bans` | List (staff) / ban `{wallet \| post, everywhere?}` / unban `{wallet, everywhere?}`. Built. |
| `POST /api/clubs/[token]/claim` | Claim ownership through `owner()` (gated). Built. |
| `PUT /api/clubs/[token]/roles` | `{wallet, role: "owner"\|"moderator"\|null}`: roles are set by the member's wallet, since the public list never shows user ids. The Owner appoints Moderators (at most 10) and hands the Club over; an admin also assigns or removes the Owner. Built. |
| `GET` / `PATCH /api/clubs/[token]/profile` | Public description, links and "holders only"; edit (Owner or admin). Built. |
| `GET /api/clubs/[token]/log` | `{log, ownership}`: the moderation log (staff); `ownership` is the on-chain check, for admins only. Built. |
| `DELETE /api/clubs/[token]` | Purge a Club that is hidden from the list (admin). A live Club is refused (`not_hidden`). Deletes members, posts, roles, profile, bans, the log and the activity log. Built. |
| `POST /api/activity` | `{hash}`, receipt-verified, rate-limited per IP. Built. |

## Code map

- **Data:** `web/data/assets.json`, `web/lib/verifiedAssets.ts` (`clubFor(token)`).
- **Server:** `web/lib/server/activity.ts` (the log), `clubs.ts` (a Club's events from the log and the pool, its summary and detail), `clubRoutes.ts` (the read handlers, built over a registry so tests can use their own list), `members.ts` (membership, Holder checks, sync, the list) and `memberRoutes.ts` (its handlers, with the caller's gate injectable for tests), `board.ts` (posts, reports, bans, roles, the claim, the profile, the purge), `boardRoutes.ts` (its handlers), `clubState.ts` (roles, profile, bans and log documents; the admin list), the store ops (`addMember`, `removeMember`, `countMembers`), and the routes under `web/app/api/clubs/` and `web/app/api/activity/`.
- **Shared:** `web/lib/momentum.ts` (the score), `web/lib/clubs.ts` (event and stats types, `summarize`, `settlementEvents`, `mergeEvents`) and `web/lib/members.ts` (`isHolder`, display wallet, stale-row picking, ranking), `clubRoles.ts` (the permission matrix, role changes) and `clubPosts.ts` (text cleaning, links, what each viewer sees, profile checks).
- **Pages:** `web/app/clubs/page.tsx` and `web/app/clubs/[address]/` with `page.tsx` and `ClubMarket.tsx`, `ClubBoard.tsx`, `ClubMembers.tsx` and `ClubManage.tsx` (the staff tab).
- **Hooks:** `useClubs`, `useClub`, `useClubMarket`, `useClubMembership` (with `useMyClubs`, `useClubMembers`), `useSignIn`, `useClubBoard` (`useClubPosts`, `useClubPage`, `useClubActions`, `useClubStaff`), on React Query and `useAccessToken`. Writes report errors through `useToast`; loads use `LoadError`.
- **Components:** `ClubCard` (with `ClubTile`), `MomentumBadge`, `HolderBadge`, `JoinClubButton`, `PostItem`.
- **Reused:** `featuredCollections` and `useCollectionInfos` for names, `useTokenInfo` for ERC-20s, `loadMetadata` for art.

## Build order

1. **Built:** `assets.json` and its loader (`lib/verifiedAssets.ts`), `momentum.ts`, `activity.ts` with `/api/activity` and `reportTx`, and the first `web` tests. The store ops come with the steps that use them.
2. **Built:** the read-only Club pages (`/clubs`, `/clubs/[address]` with the Market tab and Momentum), `GET /api/clubs` and `/api/clubs/[token]`, the matcher's `token=` and `after=` filters, and the nav link.
3. **Built:** membership (join, leave, `GET /api/me/clubs`), the Holder badge, the Members leaderboard, "Your Clubs", and wallet sync from the Privy webhook, the profile route and signed-in loads.
4. **Built:** the Board (posts, reports, auto-hide), roles (the `owner()` claim, Moderators, handing over), bans, pins, the Club page, the moderation log and the admin tools (global bans, purge). The banner image is left for later.
5. **Built:** the user guide ([07](07-user-guide.md#clubs-and-momentum)), the frontend notes ([05](05-frontend.md#clubs)) and this page.

**Not in v1:** bell notifications for a Club's posts and deals, the in-app request queue, moderators chosen by holders, cross-Club reputation on the profile, Clubs for unverified assets.

## Testing

`web` has `npm test` (`node --test`, like `matcher/`), set up in `web/test/register.mjs`, which adds extensionless imports and the `@/` alias to Node's own TypeScript support. It needs Node 24 or later. Tests cover:

- `momentum.ts`: decay, caps, wash damping, trend.
- `ingestTx` against recorded receipts, including replay.
- `clubs.ts` on the in-memory store: join and leave, holder recheck, post limits, the report threshold, bans, each role's permissions (a Moderator can't ban the Owner, the Owner can't leave without handing over), the `owner()` claim with a stubbed read, and an archived Club refusing writes.
- The matcher's `token=` filter, in `matcher/test/server.test.ts`.

By hand, with two wallets on Monad testnet:

1. Sign in, join the MockChog Club, and see the Holder badge after a mint.
2. Create a deal and fill it from the second wallet.
3. Check "Recently completed", Club Momentum going up, and both members on the leaderboard.
4. Post a "Looking for" linked to a deal, report it from 3 accounts and see it hidden, then delete it as admin.
5. Turn Privy off and see the not-configured state.
