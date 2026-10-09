# 09 · Clubs and Momentum

A **Club** is the community for one verified NFT collection, and the heart of DeClub ([ADR 0021](adr/0021-declub-pivot.md)). A memecoin made for the collection can join its Club; no ERC-20 has a Club of its own ([ADR 0025](adr/0025-clubs-are-for-nft-collections.md)). Signed-in users join it, and it shows the deals that use the asset, a board of short posts, its members, and **Momentum**, an activity score. The decision and its reasoning are in [ADR 0016](adr/0016-clubs-and-momentum.md). This page is the spec.

## What a Club gives you

- **Market:** the open deals and signed swaps that offer or want the asset, and its recent swaps.
- **Board:** short posts from members: notes, and "Looking for" posts that can link a deal.
- **Members:** a leaderboard ranked by member Momentum, with verified X or Discord handles ([ADR 0011](adr/0011-verified-profiles.md)) and a Holder badge.
- **Pulse:** the Club speaking between posts. Swaps, new deals and new members of the last week show on the Board, and on the timeline (every live Club, or the reader's own under "Joined Clubs"), as one-line **system messages** with a coloured icon per kind, grouped between posts ([ADR 0043](adr/0043-system-messages.md)). Nobody wrote them, so they have no author, likes or moderation.
- **Momentum:** how alive the asset's trading is, for the Club, and how much each member has contributed.
- **Challenges:** tasks the Owner sets the Club at any time; members answer with a post and the winners earn activity points ([ADR 0045](adr/0045-club-challenges.md); [below](#challenges)).
- **Rewards:** a share of the fees the Club's swaps paid, to its active Holders and its Owner, each week, by rules the Owner sets ([ADR 0022](adr/0022-club-rewards.md); [below](#rewards)). Fees are one source: sponsors add to the Holder pool for an epoch ([ADR 0035](adr/0035-sponsored-epochs.md)) and the Owner's challenges add points, trophies and prizes, so a Club with little trading can still pay.

No deal contract, matcher rule or pool rule depends on a Club: a deal settles the same either way. Rewards are paid after the fact, from a separate contract (`DeClubRewards`).

## Routes

| Route | What |
|---|---|
| `/timeline` | Board posts and system messages from every Club, or only the Clubs you joined (see *Screens*) |
| `/clubs` | The directory: totals, "Your Clubs", the Most active / Rising / Most traded boards, then All Clubs (see *Screens*) |
| `/clubs/[address]` | One Club, with the tabs Market, Board, Challenges, Members, Rewards, and Manage for staff |
| `/clubs/[address]/challenges/[id]` | One challenge and the entries members posted into it |

"Timeline" and "Clubs" are in the header's nav.

## Which assets get a Club

Only NFT collections marked `verified` in `web/data/assets.json` ([ADR 0014](adr/0014-verified-collections-list.md)). A cloned collection can't get a Club, and moderation stays bounded. A `blocked` entry never has a visible Club.

Verified isn't the same as having a community. Every ERC-20 entry has a `category`: `memecoin`, `stablecoin`, `wrapped` (WMON) or `other`, and only a memecoin can be in a Club, its collection's. Mock USD is verified, so its deals are trusted, and has none. Setting `club` on a token that can't have one fails the build.

A memecoin has no Club of its own ([ADR 0025](adr/0025-clubs-are-for-nft-collections.md)): its fees are too small and its holders turn over too fast for Club Rewards. Its `club` must be its collection's address, or `false` to list it verified without a Club; leaving it out, `true` or `"archived"` fails the build.

**A memecoin and its collection share one Club.** The memecoin's `club` is the collection's address:

```json
{ "address": "0x…CHOG token", "kind": "erc20", "category": "memecoin", "club": "0x…Chogs collection", … }
```

- Everything the Club keeps (members, posts, roles, bans, the activity log) is under the collection's address. `/clubs/<either address>` opens it (the other redirects), and every route takes either.
- A deal in either asset counts toward the Club's Momentum, once even when it names both. Its Market lists offers and requests for both, and a "Looking for" post can link a deal in either.
- Holding the NFT earns the Holder badge. Holding the coin does too, from `minHolding`, until the Owner sets their own rule in Manage: on or off, and the minimum ([ADR 0026](adr/0026-owner-sets-the-coin-holder-rule.md)). Only the NFTs earn Club Rewards shares (see [Rewards](#rewards)). The Owner is claimed with the collection's `owner()`.
- One memecoin per collection at most: a collection joining another Club, a second memecoin, a chain of joins, or a collection that is off, unlisted or on another chain fails the build (`parseAssets`, `makeRegistry`).

### Lifecycle

| Step | How |
|---|---|
| **Create** | Add a `verified` collection, merge it, deploy the web app. No contract deploy. Club data lives in the store, so it survives web deploys. `club: false` keeps an entry verified without opening a Club. A memecoin joins its collection's with `club: "<collection address>"`. |
| **Archive** | Set `club: "archived"`. The Club becomes read-only: no joins, no posts, board frozen. Members, posts and history are kept, and its deals still show. An Owner asks, the maintainer merges. |
| **Hide** | Turn the entry to `blocked`. The Club is hidden on the next deploy. Its data stays in the store, unseen. |
| **Purge** | An app admin calls `DELETE /api/clubs/[token]` on a hidden Club to delete its stored data. Nothing is purged automatically. |
| **Later** | The list moves to an endpoint or the store, with an in-app request and approval queue. The format and the Club data model stay the same. |

## Roles

Kept per Club, by Privy user id, in `club-roles:{chain}:{token}`. The app admin isn't stored there: it comes from `CLUB_ADMIN_USER_IDS` and outranks any Club role (an admin gets no Club role to give or take). People are named by their Club wallet in the screens and the API, never by user id.

| Role | How you get it | Can |
|---|---|---|
| **App admin** | `CLUB_ADMIN_USER_IDS` environment variable | Everything below, in every Club. Assign or remove Owners. Ban someone from every Club. Purge a hidden Club. |
| **Owner** (at most one) | **Claim:** a member whose linked wallet is the contract's `owner()`, read on chain by the server. **Or** an admin assigns one after checking the project another way. | Edit the Club profile: description (500 characters), up to 3 links (a banner image is not built yet). Pin up to 3 posts. Appoint and remove Moderators (at most 10). Hand ownership to another member. Set "holders only can post". Start, judge and cancel challenges ([below](#challenges)). |
| **Moderator** | Appointed by the Owner or an admin | Hide, restore and delete posts. Work through the report queue. Ban and unban members from this Club, but can't lift a ban the Owner or an admin made. Can't act on the Owner or on other Moderators. |
| **Member** | Joins | Post (needs a shared verified profile), like and report posts, appear on the leaderboard. |
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
- **All Clubs:** search (name, symbol, address, of either asset of a paired Club), All / With a memecoin, and sorts: busiest, rising, most traded, most members, recently active, A–Z. A list view by default (rank, Club, heat, Momentum, members, swaps in 7 days, last active), or cards; the choice is remembered per browser. Twelve at a time with "Show more". Archived Clubs go last.
- The directory draws from the assets list at once; the numbers fill in from the server, and are left out, with a note, if it can't be reached.

**`/clubs/[address]` header**

- A cover in one of the brand colours, picked from the address. The avatar is the asset's `image` from the assets list (a path under `web/public`), or its initials until it has one.
- Name, symbol, kind, a Verified chip (its tooltip is the list's note), when it was last active, an Archived chip, the description and links.
- Join / Leave. Signed out it offers "Sign in to join"; without sign-in or a store it shows nothing and the Club is read-only. A member sees a Holder badge when they hold the asset, and Leave in the "⋯" menu beside it. Joining asks the member to sign a message with their Club wallet (no gas), which keeps their spot if the list is ever lost; the menu offers it again to one who declined ([ADR 0053](adr/0053-back-up-sponsors-and-members.md)). Under Join: "Shows your wallet on the Members list."
- Stats: Momentum and its trend (with an explanation) · members and holders · swaps in 7 days · new deals in 7 days · Holders' counted Board posts and X posts in 7 days · traders in 30 days · heat.
- A collapsed **Contract details** block under the header (`ClubDetails.tsx`): the contract and kind of each asset, and which holdings earn the badge. Heat (Quiet, Stirring, Active, Busy, Hot) is one of the header stats.
- The open tab is in the URL, `?tab=market|board|challenges|members|rewards|manage`.
- The Owner sees "*X* in the Club fund is ready" when the fund can be claimed, with a link to the Rewards tab. It is worded apart from "This Club has no Owner yet · Claim it", which claims the Club, not money.

**Market tab**

Three views, switched with pills:

- **For trade:** open deals and signed swaps that offer the asset, open offers included.
- **Wanted:** open deals and signed swaps that ask for it, trait requests for the collection included.
- **Recent swaps:** the Club's latest completed swaps, with who traded and a link to the deal (or, for a signed swap, its transaction).
- For trade and Wanted show only live ones: open and not expired. Built from the existing cards, `ListingGrid` and `DealCard`.
- Says when more than 50 locked deals name the asset ("showing the newest 50 deals; browse Deals and search to see the rest") and when the signed-swap pool isn't answering.

**Board tab**: member posts, pinned ones on top, in the order of the reader's lens (Newest, Most active, Holders, Following), filtered to All or Looking for. Each post shows **Signed** and a **Follow** button beside its author.

- *Note*: plain text, 280 characters at most, plus an optional X post, shown as a card ([X posts](#x-posts)). Under the field, the composer says what makes an X post count for this Club.
- *Looking for*: text, plus an optional deal id or intent hash, shown as its card. For example "WTB any Chog with a crown, 2 MON over floor".

**Challenges tab** ([ADR 0045](adr/0045-club-challenges.md); `ClubChallenges.tsx`): a card for each challenge, open ones first, then ones being judged, then past ones, and for the Owner (or an app admin) **Start a challenge** (title, brief, who judges, points for up to three places, which epoch it ends with, and an "Only Holders can enter" box). The card (`components/ChallengeCard.tsx`, a striped trophy band with the status, the title and brief, the prizes as medal tiles, a clock bar, the leading entries) is the same one the Board and the timeline set among the posts when a challenge starts and when it is won; it opens the challenge's own page. On the Board (in every order and filter) and on the timeline, a challenge still running is pinned above the posts; when it is done it takes its place in the feed by time.

**Challenge page** (`/clubs/[address]/challenges/[id]`, `ChallengeDetail.tsx`): the brief, status, prizes, when it ends, who started it and who judges; for a member who can enter, the box where they make their entry (the link of their own X post and a line, "Sign & enter": signed and shared to the Board like any note with an X post, then entered; withdraw); every entry with its likes and, once settled, its place; and for the Owner a place picker with **Award the points** once it has ended, and cancel. The Challenges tab counts the open ones.

**Timeline** (`/timeline`, [ADR 0041](adr/0041-timeline.md)): Board posts across Clubs in one list, newest first, with a filter on top: **All Clubs** (the default: every live Club, and your own archived ones) or **Joined Clubs** (`?show=joined`: the Clubs you belong to, with a strip of them on top; signed-out readers are asked to sign in). It is a masonry where, in your own Clubs, you can like, reply and report exactly as on the Board; a card from a Club you haven't joined is read-only and says "Join to like and reply". The Clubs' system messages ([ADR 0043](adr/0043-system-messages.md)) are set among the posts as small cards that name their Club, for the same Clubs as the posts. Signed in, the composer posts to any of your live Clubs under either filter. A post is a card under a cover in its Club's colours, with the author, the text (a short post with nothing attached is set large), its X card or deal link, and its counts. The list is endless: the next page of 20 loads as the end nears (`InfiniteSentinel`), with no cap short of the Boards' own, and a failed load shows a retry button. Hidden posts, replies and pins are not shown, and moderation stays on the Board.

**Members tab**: the leaderboard. Each row shows `<Who>`, a **Follow** button, the Holder badge, join date and completed trades in this asset. A "Newest" sort is also available.

**Rewards tab**, in two views (`?view=history` for the second; the Guide explains how the numbers are worked out):

- **Overview**: a short line on how the Club earns with a link to the Guide, the running epoch's sponsors, **Your share** (ready to claim, on its way, earned here, and one **Claim** button for every open epoch), and the live standings with when the epoch closes. A **Sponsor this epoch** button sits in the header beside the two views, visible in both, and opens the sponsor form as a dialog (Escape or a click outside closes it, except while a payment is in flight).
- **History**: the latest epoch's fees, sponsored amount, Holder pool, Club fund and what rolls over, **Share the week** (a preview of the Club card first, then an X compose link with the epoch's fees and what the most active Holders were paid, linking the Club page; `web/lib/recap.ts`), who earned, and earlier epochs.

**Deep links**: not built yet. An asset row on a deal page doesn't link to its Club.

## Challenges

[ADR 0045](adr/0045-club-challenges.md), [ADR 0049](adr/0049-more-ways-to-pick-challenge-winners.md), [ADR 0050](adr/0050-challenge-rewards-beyond-points.md). Pure rules in `web/lib/challenges.ts` (`CHALLENGE_RULES`, `CHALLENGE_CAP_PER_EPOCH`, `checkChallenge`, `checkRewards`, `prizeStatus`, `isPinned`, `likesDecide`, `winnersByLikes`, `winnersByPick`, `winnersByTime`, `drawSeed`, `drawOrder`, `drawWinners`, `phaseOf`), the store logic in `web/lib/server/challenges.ts` (`createChallenge`, `enterChallenge`, `withdrawEntry`, `pickWinners`, `cancelChallenge`, `settleDue`, `listChallenges`, the raffle's `BlockReader`, `sendPrize`), the on-chain prize check in `web/lib/server/challengePrizes.ts` (`PrizeChain`, `prizeProblem`), the keys, the trophies and the points read by the rewards builder in `web/lib/server/challengeState.ts`.

| | |
|---|---|
| **Who starts one** | The Owner or an app admin, at any time, with `POST /api/clubs/[token]/challenges` `{ title, brief, judging, epochs, holdersOnly? }` and its prize. A title of at most 60 characters, a brief of at most 280. A ranked `judging` (`"likes"`, `"holders"`, `"owner"`) takes 1 to 3 `prizes` (whole points, 0 to 20 each, never more than the place above); a flat one (`"raffle"`, `"first"`, `"everyone"`) takes `winners` (1 to 25) and `prize` (0 to 10 points each), and `"everyone"` an optional `minLikes` (0 to 10). 0 points is a trophy only: the winners are named, nothing is counted. `checkChallenge` refuses a prize of the other kind. `epochs` 1 to 4: it runs to the end of the current epoch (1) or of one of the next ones, and needs at least an hour left. `holdersOnly` limits entering to members with the Holder badge (`holders_only`). Optional `rewards: { asset?, pinWinner? }` (see *Trophies*, *An NFT or token prize*, *Pinned results*). At most 3 are open at once. Logged (`create_challenge`). |
| **Entering** | `GET …/challenges/[id]` reads one with its entries. `POST …/challenges/[id] { action: "enter", post }`: a member enters one of their own top-level Board posts made after the challenge started and before it ends, that isn't hidden, and that shares their own X post (the `own` X-share test) posted on X in the same window (`not_x`, `x_not_own`, `x_too_old`). One entry each (a new one replaces the old, `withdraw` takes it back), one challenge per post, at most 200 entries. Not the Owner or an admin, and not a member banned from the Club or from rewards. Moderators may enter; one who has can't hide, delete or ban another entrant of the same unsettled challenge (`rivals`, `challenge_conflict`). |
| **Judging by likes** | Entries ranked by distinct likes from other members still in the Club and not banned from rewards, then the earlier entry; at least 1 like to win; a member wins once; as many places as `prizes`. The likes of an entry lock when the challenge ends: `likePost` refuses with `voting_closed` (`votingClosed`). |
| **Holder vote** (`"holders"`) | As judging by likes, but only likes from members with the Holder badge (the member row's, when it settles) count: `PublicEntry.votes`. Anyone may like; likes lock at the end. |
| **Raffle** (`"raffle"`) | Two steps of `settleDue`, under the settle lock. After the end it commits `drawBlock` (the newest block + `drawMargin`, 10) and `drawPool` (the entries that can win, sorted by post id); with no entries it settles with none. Once that block is finalized: `seed = keccak256(blockHash ‖ challengeId as UTF-8)` (`drawSeed`), the pool is shuffled with it (`drawOrder`: Fisher–Yates from the end, position `i` swapping with `keccak256(seed ‖ uint256(i)) mod (i + 1)`), and the first `winners` still able to win, win (`drawWinners`); one that dropped out is skipped, not redrawn. `Settlement.draw` is `{ block, hash, seed, pool }`. The blocks are read through `BlockReader` (viem, or a fake in tests); a failed read waits for the next settle. Once the block is committed it can't be cancelled (`drawing`). Likes don't lock. |
| **First in** (`"first"`) | Entries stay open to the end; at the settle the first `winners` entries that can still win, by Board post time, win (`winnersByTime`); later ones are reserves. Likes don't lock. |
| **Everyone who completes** (`"everyone"`) | Every entry with at least `minLikes` likes from other members (counted as for judging by likes) wins, up to `winners`, earliest first. Likes lock at the end when `minLikes` is above 0 (`likesDecide`). |
| **Judging by the Owner** | Once it has ended, `POST …/challenges/[id] { action: "pick", posts: [id, …] }` names the winners best first, among the entries that can win (not hidden, not deleted, the member still in and not banned). After 14 days with no pick it ends with no winners (`expired`). |
| **Settling** | `settleDue` settles everything that has ended: on `GET …/challenges`, in the live standings, and in `/api/cron/close` before the epoch is frozen. Locked per challenge; a win is keyed by challenge id, so a repeat pays once. Logged (`settle_challenge`). |
| **The points** | A win is `prizes[place − 1]` points in epoch *n* (a flat challenge keeps `prizes` as `winners` equal values, and its winners have places 1..N in draw or time order, shown as "Winner"): the epoch the challenge ended with while it isn't closed, else the running one; an Owner pick counts in the epoch it is made. A 0-point win is published with the challenge but adds nothing to the epoch. Kept at `declub:challenge:{chain}:{club}:awards:{n}`, by user id. When the epoch's inputs are read (`readInputs`) a member's wins count up to `CHALLENGE_CAP_PER_EPOCH` (20), frozen in `ClosingHolder.challenge`, and enter `activityPoints` as ordinary points (bonus and ramp). A member banned from rewards wins nothing. |
| **What an entry earns** | Only its prize ([ADR 0048](adr/0048-entries-earn-through-their-challenge.md)). Entering marks the post (`StoredPost.entry`) and its X share (`XShare.entry`) with the challenge, and the challenge keeps every post it covered (`…:entered:{id}`). A marked post still counts toward Momentum, but `activeDays` skips it, `activityPoints` skips its X share, and backing on it (`BackingAction.entry`) backs nobody while still counting as engaging for the giver. Entering clears the day's X-share limit. The mark stays after a withdrawal; `cancelChallenge` clears it on every covered post. A post from an epoch already frozen can't be entered (`bad_post`). |
| **In the bell** | `challengeNews` in `web/lib/server/inbox.ts` reads the stored challenges of up to 10 of a member's Clubs (no settling), each item keyed `{kind}:{club}:{id}` so it is news once: `challenge-new` (open, started in the last 14 days) and then `challenge-ending` (its last 24 hours) to a member who could enter and hasn't (not the Owner or an admin, not banned from rewards, a Holder for a Holders-only one); `challenge-won` (with the place for ranked judging, and the points) or `challenge-results` to an entrant, settled in the last 14 days; and, to the Owner or an admin, `challenge-pick` for an Owner-judged one that has ended with entries, then `challenge-pick-soon` in the last 3 days of the pick window, both marked as needing them. With an asset prize: `challenge-prize-sent` to a winner once theirs is checked, and `challenge-prize-owed` (needing them) to the Owner or an admin while any is owed, whatever its age, keyed again with `:overdue` once overdue. A cancelled challenge sends nothing. |
| **Trophies** | Every winner of a settled challenge, in every mode and for a 0-point win too, gets a trophy in `finish`: `{ club, challenge, title, place, at, wallet }` (`place` 1–3 when ranked, `null` when flat), kept per user at `declub:challenge:{chain}:trophies:{userId}` (newest first, at most 200), one per challenge however often it settles. None for a cancelled challenge. `GET /api/wallets/[address]/profile` returns `trophies` (with `clubName`) and the Members list rows `trophies` (this Club's), both only for wins published under that wallet. |
| **An NFT or token prize** | `rewards.asset: { token, amounts }`: one asset with status `verified` (`checkRewards`; blocked and unlisted refused). ERC-721: whole NFTs, 1 to 5 (`maxPrizeNfts`); ERC-20: token units up to 1,000,000,000 (`maxPrizeTokens`), converted with the decimals the server reads from the contract (`PrizeChain.decimals`; none read, refused). Ranked: one amount per paid place, never more for a lower place, the first above 0; flat: one amount for each winner. Kept with `kind`, `name`, `symbol`, `decimals` and base-unit `amounts`. Never counted in an epoch. On the settle each winner with an amount has `Winner.prize` (owed). `POST …/challenges/[id] { action: "prize_sent", post, tx }` (Owner or admin): the receipt (`PrizeChain.receipt`) must have succeeded, in a block at or after `settled.at`, with `Transfer` logs of the asset's contract to any of the winner's linked wallets (or their published wallet) adding up to the amount (ERC-20 value; ERC-721 distinct ids): else `tx_not_found`, `tx_failed`, `tx_too_early`, `wrong_asset`, `wrong_recipient`, `too_little`, `chain_unavailable`. A tx pays one prize (`…:prize-tx:{hash}`, `tx_used`). Then `Winner.sent = { tx, at }`; logged (`prize_sent`). 14 days after the settle (`prizeDueMs`) an unsent prize is overdue: "Prize not sent" on the card and the page, and a new challenge with an asset prize in that Club is refused (`prize_overdue`). The app never holds or sends a prize. |
| **Pinned results** | `rewards.pinWinner`: for 3 days after it settles with winners (`pinResultsMs`, `PublicChallenge.pinUntil`), the challenge stays pinned on top of the Board as "Challenge results" with the winning entry (1st, or a flat prize's winners) drawn out; `isPinned` and `withoutPinned(events, pinned, results)` keep its start and result out of the feed meanwhile. |
| **Published** | `PublishedLedger.challenges` is `{ cap, wins: [{ challenge, title, wallet, place, points }] }` and each ledger row has `challengePoints`; the live standings row has `challengePoints` too, and the Points meter shows a Challenges line. |

## Momentum

Pure functions in `web/lib/momentum.ts`, computed from the Club's activity log over the last 30 days with a 7-day half-life. An event weighs `w × 0.5^(age / 7 days)`.

| Event | Weight | Why |
|---|---|---|
| Completed swap containing the asset (escrow fill, accepted proposal, settled intent) | 10 per side | Each side pays the protocol fee for every NFT it gives ([ADR 0015](adr/0015-protocol-fee.md), [0033](adr/0033-fee-per-nft.md)), so faking it costs real money. A swap counts once however many NFTs it moves; the fee is what scales with them |
| New deal, open offer or intent naming the asset | 2, at most 3 per wallet per day | Cheap to make, so capped |
| A Holder's own X post about the Club, shared on its Board ([X posts](#x-posts)) | 3 (1.5 if it only matches a tag), at most one a day per member per Club | Attention is part of a Club's life; capped low and limited to Holders so it can't outweigh trading |
| A Holder's top-level Board post ([ADR 0047](adr/0047-board-posts-in-momentum.md)) | 4, the first a day per member per Club | Talk on the Board is part of a Club's life too. Limited to Holders and to one a day so posting can't outweigh trading; a hidden or deleted post counts for nothing, and the member's next post that day takes its place |
| Replies, and Board posts by members who aren't Holders | 0 | Giving them no weight means spam doesn't pay |

- **Club Momentum** = decayed sum × `(1 + log2(unique wallets in 30 days)) / 4`. Breadth counts, so one wallet trading with itself barely moves it; X shares and Board posts don't add to the breadth (or to "Traders · 30 days"). The trend compares it with the same score as of 7 days ago.
- **Member Momentum** = the decayed weights of events where one of the member's linked wallets is a party. A completed swap with a counterparty already traded with in this Club in the last 7 days counts half (wash damping).
- All constants live in one exported object, so they can be tuned without touching logic.
- Results are cached per Club in the store for 60 seconds.

What Momentum doesn't say: that a Club is good, that its asset is safe, or that a member is honest. It says "this market has been busy". A well-funded actor can still inflate it, at the protocol fee on every side plus gas.

## Where the activity comes from

There is no indexer, and the public RPC caps `eth_getLogs` at 100 blocks ([ADR 0003](adr/0003-no-indexer-in-v1.md), [0004](adr/0004-read-deals-from-storage.md)). `DeClubEscrow` stores no creation or fill time either. So the log is built from **receipts the server verifies itself**, the way `ingestFills` already works ([ADR 0012](adr/0012-server-side-saves.md)).

- **`ingestTx(store, hash)`** in `web/lib/server/activity.ts` fetches the receipt and decodes it (`recordActivity` is the part after the receipt is in hand). Each event becomes `{id, kind, contract, deal, block, at, parties[], tokens[]}`, with `id` = `txHash:logIndex`, so a replay is the same event. It goes into the log of every Club it names, once per Club, under the Club's own asset; an event that names no Club asset is dropped, so the log can't grow unbounded.
  - `DeClubEscrow` only: `TradeCreated` is a `created` event; `TradeFilled` is a `swapped` one. The deal's assets come from `getTrade`, plus the proposal's assets when the same receipt holds the `ProposalAccepted` that filled it. A swap's parties are the maker and the taker. Native MON never counts as a token. A reverted transaction records nothing.
  - The log is one sorted set per Club, scored by block time, whose members are the events as JSON. Trimming at 5000 therefore leaves nothing behind, and storing the same event twice is a no-op.
- **`POST /api/activity {hash}`** reads the receipt once and feeds both History (`recordFills`, the part of `ingestFills` after the receipt) and the Club log. `POST /api/fills` stays for older clients.
- **Client:** `web/lib/fillReport.ts` has `mayFill` (a fill: awaited, History needs it before it refetches), `mayReport` (a fill, or an escrow `createTrade`, `createTraitTrade` or `createOpenOffer`: fire-and-forget) and `reportTx`. Accepting a proposal is a fill.
- **Signed swaps** are not in `ingestTx`, and are not copied into the store. The Club routes read the matcher's `/settlements?token=` when asked (cached 30 s per Club in the server process) and merge it with the log by event id. A settled cycle is one swap with every maker in it as a party. A pool that is down only costs the signed swaps. This needs no cursor, and it relies on the matcher keeping its history.
- **A Club added later has no past:** only events recorded while its asset was on the list count, until the fill watcher backfills it ([ADR 0019](adr/0019-fill-watcher.md), `FILL_WATCHER_START_BLOCK`).
- **Matcher:** `GET /intents` and `/settlements` take `?token=`: any intent naming that address on either side, whatever the id (it matches the address inside the `intent_assets` key, so there is no schema change). `/settlements` also takes `?after=` (milliseconds; later cycles only, oldest first) for a reader that pages forward. `web/lib/pool.ts` passes `token`.
- **Deals feed** comes from the server's deal book ([ADR 0020](adr/0020-server-side-deal-book.md)): `useClubMarket` asks `/api/deals` for the open locked deals that name the Club's assets, across every deal, and `offersToken` / `requestsToken` in `lib/dealFilters.ts` split them into For trade and Wanted.
- **Deals made outside the app** come in through the fill watcher ([ADR 0019](adr/0019-fill-watcher.md)): a cron (`GET /api/cron/fills`) that follows the finalized head from a cursor and passes each transaction through `recordActivity`, so they count within a run's interval. With `ENVIO_API_TOKEN` it finds the transactions with Envio HyperSync, so a backfill from the deploy block takes a few queries instead of one per 100 blocks ([ADR 0051](adr/0051-hypersync-for-the-fill-watcher.md)). It runs only with a store and `CRON_SECRET` set; without it, Momentum counts only what the app itself reported.

## Membership and the Holder badge

- **Join:** needs sign-in and at least one linked wallet (422 `no_wallet` otherwise). The member row snapshots `linkedEthereumWallets(user.linked_accounts)` (`web/lib/profiles.ts`), never anything from the request. The display wallet, the one the Members list shows, is the first with a shared profile, else the first. Joining twice is the same as once; an archived Club refuses (409 `archived`); a Club stops at 2,000 members (409 `full`). **Joining publishes the display wallet**, so the button says so.
- **Holder:** ERC-721 `balanceOf ≥ 1` across the member's wallets, or, in a Club with a memecoin that counts it, the coin's `balanceOf ≥` the minimum. The Owner's rule (`coinHolders` in the Club profile: `on`, `min` in base units, `at` when it changed) wins; without one, the coin counts from `minHolding` (an optional `assets.json` field). A row checked before `at` is re-checked like a stale one. If one asset can't be read and the other doesn't make the member a Holder, the old badge stays. Checked on join, then rechecked when the row is over 24 hours old and the members list is read: one `multicall` per member, at most 50 members per read (oldest check first), so the badge is at most a day old. A member's own reads are fresher (`freshHolder`): their membership `GET` re-reads a member without the badge when the last check is over a minute old, and entering a Holders-only challenge re-reads anyone's, so an NFT just swapped for counts at once and one just sold stops counting. A read that fails keeps the old badge and tries again next time. Without `minHolding`, an ERC-20 Holder holds any amount.
- **Wallets kept in step:** the Privy webhook handler, the profile route (share or stop sharing) and every signed-in `GET .../membership` re-sync `wallets[]` and the display wallet in every Club the user belongs to (`syncMemberships`). New wallets reset the balance check. Unlinking a wallet drops its Momentum from that member. **A user left with no linked wallet (or deleted) leaves every Club,** since there is nothing to show or score; joining again takes a wallet.
- **Leave** deletes the row and the set entries, and any role with it. The Owner can't leave without handing the Club over (409 `owner_cannot_leave`).
- **Public list:** `GET .../members` never includes a user id. A member is their display wallet, with holder flag, join date, Momentum and completed swaps (events the log and pool know of, where one of their wallets was a party). It is paged (`page`, `size`; the Members tab asks for 25 at a time, a request may ask for at most 100) and counts everyone; a page past the end is the last one. `q` keeps the members whose wallet, or the X / Discord handle shown under it, contains the text (at most 64 characters); a member keeps their true rank in the Club, and `matches` counts them.

## Board and moderation

This is the first user-written content in the app. Every post is signed by its author's wallet ([ADR 0023](adr/0023-signed-posts-and-lenses.md)).

- **Signing:** the composer cleans the text and puts the link in canonical form (`draftPost` in `web/lib/social.ts`), then the member's **Club wallet** signs the EIP-712 `Post { club, kind, text, link, at }` under the domain `("DeClub Social", "1", chainId)`. The server refuses a post that isn't signed (`unsigned`), names another Club (`wrong_club`), differs from what it would store (`not_clean`), was signed more than 5 minutes from its clock (`stale`), or isn't signed by the member's Club wallet (`bad_signature`). The id is the message's struct hash; sending the same signed post again returns it.
- **Lenses:** `GET .../posts?lens=newest|momentum|holders|following&as=<reader's wallet>` (`web/lib/lenses.ts`). Most active weighs each post by its author's Momentum and halves it every 24 hours; Holders keeps posts by members holding the asset; Following keeps posts by wallets the reader (`as`) follows, and drops the pins.
- **Export:** `GET /api/clubs/[token]/feed` serves every signed post as its message and signature, with the domain and types; posts hidden by moderation are left out until restored. `GET /api/wallets/[address]/posts` serves a wallet's posts across Clubs.
- **Follows:** a signed `Follow { follower, target, following, at }` from one of the caller's linked wallets (`POST /api/follows`), newest record wins, at most 1,000 per wallet and 120 changes an hour. `GET /api/wallets/[address]/follows` serves them.

- **Who can post:** members with a **shared verified profile** (ADR 0011), not banned in that Club, in a Club that isn't archived. If "holders only can post" is on, holders only, except the Owner, Moderators and admins. The post shows the member's Club wallet.
- **Text:** at most 280 characters (counted as characters, so an emoji is one). Control characters, line breaks, zero-width and bidirectional-override characters become spaces, runs of spaces collapse, the ends are trimmed. It is shown as plain text: React escapes it, there is no markdown, and URLs aren't linked.
- **Links:** a "Looking for" post can carry a deal id or a signed-swap hash; the server checks that it exists and names the Club's token (`link_not_found`, `link_mismatch`; `link_unavailable` when the lookup itself fails). A note can carry an X post link (`x_not_found` when it isn't public, `x_unavailable` when X can't be read); see [X posts](#x-posts). Either way, one link per post (`bad_link` for the wrong kind).
- **Rate limits** (`withinLimit`), applied after the checks above so a post the server refuses doesn't use one up: a 30-second cooldown and 5 posts an hour, per user per Club; 20 reports a day per user.
- **Reports** ([ADR 0040](adr/0040-points-floor-held-average-public-backing.md)): a member can report a post once (a set per post, so the same member twice adds nothing) and not their own. Every report is recorded and the post is marked `reported`, but **nothing is hidden by reports**: a hidden post's backing counts for nothing, so a group could otherwise strip a rival's points. Staff see the report count on the post, with Holders' and staff's reports counted apart, and in the **Reported** list on the Manage tab (`GET /api/clubs/[token]/reported`, a set of reported ids per Club that prunes itself), where they can hide, delete or dismiss (a restore clears the reports). Posts that three reports hid before ADR 0040 stay hidden (`hidden: "reports"`, and the log's `auto_hide`) until staff act, and still count for points.
- **Replies** ([ADR 0032](adr/0032-live-standings-active-days-and-replies.md)): one level under a top-level post, signed as `Reply { club, parent, text, at }` (`draftReply`), so posts' ids don't change. Stored as a post with `parent`, so likes, reports, hiding, deleting and bans apply unchanged; not on the Board list or in the lenses, not pinnable, no link. Every Board rule for posting applies, plus `not_found` (no such post, or it's a reply), `hidden` (the post is hidden) and `thread_full` (50 replies). A 10-second cooldown and 20 an hour. Deleting a post deletes its thread; a hidden post's thread is shown only to staff and the author. A reply makes its author's day active and gives the post's author part of their voice ([ADR 0038](adr/0038-points-from-backing.md)).
- **Likes** ([ADR 0030](adr/0030-likes-club-inbox-and-recap.md)): a member likes a post once (a set per post, plus the member's own set so a read can mark theirs) and can take it back. Not their own post, not a hidden one, 120 an hour. A like is attention and nothing more: it counts for no Momentum, no Holder bonus and no reward, so there is nothing to farm. It reaches the author through the Club inbox.
- **Moderators and above** hide and restore posts (restoring clears the reports), delete posts, and ban, all subject to the permission matrix above. Hiding or deleting a post unpins it. **Authors** can delete their own posts, which isn't logged.
- **Bans:** by wallet (a member) or by post (that post's author, which reaches a spammer who already left). A banned user leaves the Club, loses any role, and can't rejoin or post. Only an admin can ban the Owner, or ban everywhere (which removes the user from every Club). Lifting a ban doesn't put anyone back. Nobody can ban themselves.
- **Archived Clubs** refuse joining, posting and reporting. Staff can still delete, hide and ban, and the Owner can still pin.
- **The Owner's claim:** `POST .../claim` reads the token's `owner()` on chain. If one of the caller's linked wallets is it, they become Owner and the claim is recorded. A second claimant gets `has_owner` (an admin decides); a token with no `owner()` gets `no_owner`. An admin reading the log is also told when `owner()` no longer matches the claim.
- **Club page:** the Owner or an admin edits a description (500 characters), up to 3 `https://` links (they become anchors with `rel="noopener noreferrer nofollow"`, so nothing else is accepted) and "holders only can post". **A banner image is not built yet.**
- **The log:** every role change, ban, hide, restore, staff delete, pin, claim and profile edit, as wallets rather than user ids, newest first, capped at 1000. Staff read it.

## X posts

[ADR 0024](adr/0024-x-posts-and-the-holder-bonus.md). Pure parts in `web/lib/xPosts.ts` (links, signals, matching), the server in `web/lib/server/xPosts.ts` (oEmbed, X shares, linking the project's account), `xApi.ts` (the paid X API) and `xReach.ts` (reach, once per epoch).

- **Sharing:** a note's link may be any x.com or twitter.com post link; it is signed as `https://x.com/i/status/<id>`. The server reads the post through X's free oEmbed endpoint (`publish.x.com/oembed`) and keeps a card: author, text (plain, at most 400 characters), and the time, read from the post id. The card is not part of the signed message, and is hidden with the post's text.
- **An X share** is a shared X post that counts. It needs all of:
  - the author is the member's own X account, as Privy verified it (`twitter_oauth`);
  - the member holds the Club's asset (the Holder badge);
  - the post is at most 48 hours old;
  - it is about the Club (below);
  - it never counted before (in any Club);
  - it is the member's first in this Club this UTC day.

  Otherwise it is a card only, and the author is told why (`not_own`, `not_holder`, `too_old`, `no_signal`, `daily_limit`, `already_counted`). Hiding the Board post (by staff or reports) stops its X share counting until it is restored; deleting the post ends it.
- **About the Club**, by `matchSignals`, yes or no per post:

  | Strength | When | Counts |
  |---|---|---|
  | Strong | It names the Club's token address or links its Club page; mentions a linked project account; quotes or replies to one of its posts | In full |
  | Weak | It only matches a tag: `$SYMBOL` of each Club asset (always), or one of the Owner's up to 10 hashtags, cashtags or words, as a whole word | Half |
  | None | Nothing matched | Not counted |

- **The project's X account** (up to 3 per Club), linked by the Owner or an admin in **Manage → The Club on X**:
  1. `POST .../x {action: "start", handle}` gives a one-time code, good for 24 hours, and the text to post.
  2. The Owner posts that text from the account.
  3. `{action: "verify", handle, url}` reads that post through oEmbed and links the account if the author matches and the code is in it.

  With the X API configured, the account's numeric id is saved too, so a rename doesn't break it. `DELETE .../x {handle}` unlinks. The Club page shows linked accounts as "@handle ✓". Refusals: `bad_handle`, `already_linked`, `too_many_accounts`, `xlink_expired`, `xlink_mismatch`, `xlink_unavailable`.
- **Counting only, by default.** With no `X_BEARER_TOKEN`, every counted X share adds the same points, and nothing is read again at the epoch: a post deleted on X after sharing still counts (hiding or deleting the Board post stops it). Quotes and replies of the project account and `t.co`-shortened Club links aren't detected; plain @-mentions, the address in the text and tags are.
- **Reach, with the X API (built, off until `X_BEARER_TOKEN` is set):** with no token the app runs counting only. With the token set, `npm run rewards:epoch` reads every X share of the epoch before building it (`GET /2/tweets`, 100 per call). It checks each share again:
  - the author by X's numeric id (Privy's `subject`);
  - the signals, with the full links and the authors of quoted and replied-to posts, so a post can turn strong, or drop out if edited or deleted.

  It records engagement = likes + reposts + quotes + replies (impressions are left out). The read is saved (`rewards:{chain}:reach:{n}`) and published in the epoch. About $0.005 a post. `GET /api/clubs/[token]/rewards` says which mode is on (`xReach`), and the Rewards tab words itself to match.

## Rewards

[ADR 0022](adr/0022-club-rewards.md). Pure parts in `web/lib/rewards.ts` (`PROTOCOL`, `DEFAULT_CLUB_RULES`, `epochWindow`, `rewardLeaf`, `splitClub`, `leavesOf`), the builder in `web/lib/server/rewards.ts`, the contract `DeClubRewards`.

| Share of a Club's swap fees | Goes to |
|---|---|
| 50% | The Club's active Holders ([ADR 0044](adr/0044-owner-reward-settings.md), amending [ADR 0040](adr/0040-points-floor-held-average-public-backing.md) and [ADR 0037](adr/0037-most-active-holders-are-paid.md)): members holding at least one NFT of the collection, summed over their linked wallets and read when the epoch is built, with at least 1 activity point (`PROTOCOL.minPaidPoints`). By default all of them are paid; the Owner can limit it to the most active (`maxPaid`, `maxPaidPercent`; `seatsFor`, `paidPlaces`; `rankHolders` orders them, a tie going to the bigger holding, then the earlier member, then the lower wallet). Those paid share the pool by NFTs held (averaged over the week) × (1 + activity bonus) × the ramp `min(1, points / rampPoints)` (`rampBps`; `rampPoints` 5 by default): a whole share from 5 points, half at half of that, no cliff. If the Owner pays members without NFTs (`nonHolderBps`, up to 30%), that slice of the Holder pool goes to them by points (counting up to `fullBonusPoints`), `kind: "member"`. Members banned from rewards are left out. A Club's memecoin earns the Holder badge, not shares ([ADR 0025](adr/0025-clubs-are-for-nft-collections.md)). Joined members only, paid at their Club wallet. |
| 25% | The Club fund, paid to the Owner's Club wallet. |
| 25% | Stays with the protocol. |

- **Rules** ([ADR 0040](adr/0040-points-floor-held-average-public-backing.md), [ADR 0044](adr/0044-owner-reward-settings.md)): each epoch is scored by a `ClubRules` value, published with it. The Owner sets only the paying rules (`OWNER_RULES`: `rampPoints`, `maxPaid`, `maxPaidPercent`, `nonHolderBps`), within `CLUB_RULE_BOUNDS` (`checkRules`; a save can't carry anything else, `ownerRulesOf`). How points are counted (`fullBonusPoints`, `dayPoints`, `voicePerNft`, `voiceCapNfts`, `likeWeight`, `replyWeight`, `firstReplyWeight`, `engageReplyPoints`, `engageLikePoints`, `engageCapPerEpoch`, `mutualFactor`, `pairCap`, `swapPoints`, `swapCapPerEpoch`, `streakMinDays`, `streakStepBps`) is `DEFAULT_CLUB_RULES` in every Club, and `PROTOCOL` (the fee split, the bonus caps, the base voice, the X weights, the 1-point minimum) is fixed. The Owner or an app admin changes them with `PATCH /api/clubs/[token]/rules` (the Manage tab's Rewards panel; `GET` is public and also gives any waiting change and the bounds). A change saved in epoch n applies from n + 1; a second one in the same epoch replaces the first; each save is kept at `declub:club-rules:{chain}:{club}` and logged (`edit_rules`). `rulesFor(store, club, n)` (`web/lib/server/clubRules.ts`) is the only source for the builder and the standings. `REWARDS` remains as the defaults merged with `PROTOCOL`. The rules used are published in `EpochRecord.clubs[].rules`, `ClubStandings.rules` and the points ledger.
- **Bans from rewards** ([ADR 0044](adr/0044-owner-reward-settings.md)): the Owner or an app admin bans a member by Club wallet (`POST`/`DELETE /api/clubs/[token]/reward-bans`; staff can `GET` the list; only someone who outranks the member). The member stays in the Club but isn't paid, and their likes and replies give nobody points, in every epoch not yet closed. Kept at `declub:reward-bans:{chain}:{club}`, logged (`reward_ban`, `reward_unban`), frozen at the close and published per epoch as `excluded`; what they gave is in the published backing as `removed`, `by: "reward_ban"`.
- **Holdings are averaged over the week** (ADR 0040, `web/lib/server/held.ts`): `GET /api/cron/holdings` (`CRON_SECRET`, daily from `web/vercel.json`) reads every Club's members' NFTs once per UTC day and adds them to `declub:held:{chain}:{club}:{n}` (`{ days, sums }` by user id; a Club already sampled that day is skipped). The builder adds the read at close and divides by `days.length + 1`: that average (`held`) is what the NFT voice and the share of the pool use, so NFTs bought on the last day count for a fraction, a day before someone joined counts as zero, and a member sampled earlier keeps that voice if they sold before close, though being paid needs at least 1 NFT at close. With no samples the average is the holding. Published as `held` on payouts and standings rows, and `samples` per Club.
- **The close** ([ADR 0040](adr/0040-points-floor-held-average-public-backing.md), `closeEpoch` in `web/lib/server/rewards.ts`): `GET /api/cron/close` (`CRON_SECRET`, daily from `web/vercel.json`) freezes each Club's inputs for the epoch that just ended, once each, at `declub:rewards:{chain}:closing:{club}:{n}` (server-private: it holds user ids and linked wallets): holdings read and average, the backing and active days that still stood, the rules, and the published backing. `buildEpoch` scores from it (`scoreHolders`) and freezes any Club the job missed, so a like taken back, a deletion or a moderator's hide after the close changes nothing. Swaps, X shares and reach are read at build. `EpochRecord.clubs[].closedAt` says when. The build stores the final ledger of every Holder's points at `rewards:{chain}:points:{n}`, served at `GET /api/rewards/epochs/[n]/points`.
- **Epochs:** a week by default (`NEXT_PUBLIC_REWARDS_EPOCH_SECONDS`), numbered from `NEXT_PUBLIC_REWARDS_GENESIS` (default 2026-10-05 00:00 UTC). An epoch is built after it ends, in order (`out_of_order` otherwise), once (`exists` after), under a lock.
- **Fees:** each completed swap's `fee` (both sides together): from the escrow fill's `FeeCharged` in the activity log, or the settlement's `FeeCharged` for a signed swap. A swap in k Clubs gives each 1/k. Before a Safe signs, `rewards:verify` checks the credited fees against the contracts' `FeeCharged` logs for the epoch ([ADR 0052](adr/0052-check-epoch-fees-against-fee-logs.md)).
- **The activity bonus** ([ADR 0024](adr/0024-x-posts-and-the-holder-bonus.md), [ADR 0032](adr/0032-live-standings-active-days-and-replies.md), [ADR 0038](adr/0038-points-from-backing.md)): a Holder's shares count up to 25% more (`PROTOCOL.maxBonusBps`, 50% before ADR 0044) for their activity in the Club during the epoch, counted in full with no decay (`activityPoints`):
  - **backing**, most of the points (`backingPoints`, [ADR 0039](adr/0039-base-voice-for-verified-accounts.md)): two voices a week. A Holder's **NFT voice** is 10 points per NFT (`voicePerNft`), counting at most 5 NFTs (`voiceCapNfts`), averaged over the week (below), and is shared over the likes and replies they gave in that Club. Every **verified account** (a shared X or Discord profile, first shared at least 7 days before the epoch ends: `verifiedDays`, `StoredProfile.since`) also has a **base voice** of 3 (`baseVoice`), shared over the likes and replies they gave in every Club (`givenEverywhere`, indexed per user at `declub:backing-by:{chain}:{n}:{userId}`). Weights: a like 1, a reply 2, the first reply on a post from anyone but its author 4 (`likeWeight`, `replyWeight`, `firstReplyWeight`). What a member's posts and replies received is their backing; at most 10 of it from base voices (`baseCapPerReceiver`). Actions on oneself carry nothing; two members who both have a voice and backed each other get half each way (`mutualFactor`); one member gives another at most 20 points an epoch, both voices together (`pairCap`, [ADR 0044](adr/0044-owner-reward-settings.md), the same in every Club). Each like and reply is recorded when given (`web/lib/server/backing.ts`, `declub:backing:{chain}:{club}:{n}`, `kind|day|postId|userId`) and checked when read: a like taken back, a deleted post or reply, or a post or reply a **moderator hid** (or one under a post a moderator hid) counts for nothing; reports alone remove nothing (`removedForRewards`). Likes aren't signed, so each epoch publishes who backed whom at `GET /api/rewards/epochs/[n]/backing` (`declub:rewards:{chain}:backing:{n}`): by Club and public wallet, the voices, every action that counted, and what a moderator's hide `removed`, so anyone can recompute each Holder's points with `backingPoints` and the epoch's rules. Each payout also publishes its `backed` points;
  - per **active day**, 1 (`dayPoints`): a UTC day with a visible top-level Board post by the member in the Club, or a like or reply they gave there, at most 7 an epoch. Posts are recorded when posted (`web/lib/server/activeDays.ts`, the first 3 a day), likes and replies with backing; a deleted post, or one a moderator hid, counts for nothing, and a like given again after being taken back adds no day (its day counts once, the first);
  - for **engaging** ([ADR 0046](adr/0046-points-for-engaging.md), `engagementPoints`): what a member earns themselves for the likes and replies they gave, counted per other member, not per action: 1 for each member they replied to (`engageReplyPoints`), 0.5 for each they only liked (`engageLikePoints`), at most 5 an epoch (`engageCapPerEpoch`). Read from the same recorded backing, so a like taken back, a moderator's hide, an action on oneself, and anything a member banned from rewards gave count for nothing. No voice needed: members without NFTs earn it too. Frozen in `ClosingHolder.engaged`; ledger and standings rows have `engagedPoints`, and the Points meter shows an Engaging line;
  - per X share, 3, halved for a weak one;
  - per **completed swap** with a wallet that isn't the member's own, 2 (`swapPoints`), half for a counterparty they already swapped with in the epoch within 7 days (Momentum's `washFactor`), at most 14 an epoch (`swapCapPerEpoch`, [ADR 0034](adr/0034-swaps-count-in-the-holder-bonus.md)). A swap between a member's own wallets earns nothing;
  - **challenge wins** ([ADR 0045](adr/0045-club-challenges.md)): the points the Owner set for a place in a challenge the member won, at most 20 an epoch (`CHALLENGE_CAP_PER_EPOCH`; [Challenges](#challenges));
  - with reach on (needs `X_BEARER_TOKEN`), `2 × log2(1 + engagement)` more per share, capped at 30 per member per epoch; a share the reach read refused counts 0.

  `bonus = 25% × min(1, points / 35)`: a post and an X share every day (28) isn't enough alone; backing makes up the rest. Each holder payout in the record carries `shares`, `bonusBps` (activity plus streak), `points`, `days`, `streak` and `backed`. Splitting holdings across accounts gains nothing but rounding.
- **Streaks** ([ADR 0032](adr/0032-live-standings-active-days-and-replies.md)): an epoch with at least 3 active days (`streakMinDays`) keeps a member's streak going; from the second epoch in a row it adds `250 × (streak − 1)` basis points, up to 10% (`maxStreakBps`), on top of the activity bonus. Only the epoch builder writes streaks (`rewards:{chain}:streaks:{club}`, by user id), so a rebuild agrees. Members who aren't Holders keep streaks too; the Members list shows a flame from the second week.
- **Live standings** ([ADR 0032](adr/0032-live-standings-active-days-and-replies.md)): `clubStandings` in `web/lib/server/standings.ts` runs the open epoch through the same inputs and `splitClub` as if it closed now: each Holder's rank (`rankHolders`), points (with where they came from: backing and how many Holders gave it, engaging, active days, X shares, swaps, challenges), bonus and estimate, and the reader's `gap` (`entryGap`: the points still missing to be paid, against the last paid place when the Owner limited them) and `toFull` (`rampGap`: the rest of the ramp). Members without NFTs get their own rows (`members`) when the Club pays them, and a banned reader is told so. Rows show the average NFTs held when it differs from what they hold now. Cached per Club for 5 minutes, one rebuild at a time, the last copy served when balances can't be read. An estimate: a swap's fee is split between the Clubs its tokens belong to, and reach isn't read until the epoch is built.
- **Sponsors** ([ADR 0035](adr/0035-sponsored-epochs.md), [ADR 0036](adr/0036-sponsor-from-the-app.md)): a project, partner or the Club's Owner can add MON to one Club's Holder pool for one epoch. The sponsor's signature is kept with the entry, and `rewards:sponsor --export` / `--restore` back the ledger up and rebuild it from the chain ([ADR 0053](adr/0053-back-up-sponsors-and-members.md)). From the app: the **Sponsor this epoch** panel on the Rewards tab pays the operator and signs a name; `POST /api/clubs/[token]/sponsor` reads the payment off the chain (amount, payer and block time from the transaction, at least 0.1 MON, sent to the operator) and records it, once per transaction, in the epoch of its block (the next if that one is built). The recap names only operator-recorded and Owner sponsors. From the CLI, the sponsor sends the MON to the operator; `npm run rewards:sponsor -- --epoch N --club 0x… --amount 5 --name "…" [--owner]` records it (`recordSponsor`, `declub:rewards:{chain}:sponsors:{n}`) before the epoch is built. All of it joins the Holder pool (split as above), none goes to the fund or the protocol; with no Holders it carries to the next epoch. The built epoch publishes `sponsored` and `sponsors` per Club, and the Rewards tab, live standings and the weekly recap show them.
- **Carry:** a Club with no paid Holder (none holding an NFT with a point) keeps its Holder pool, one with no Owner keeps its fund, and rounding dust stays too, all rolling into the next epoch (`declub:rewards:{chain}:carry:{club}`).
- **Leaves:** one per account per epoch, the sum across Clubs, with a per-Club breakdown; sorted by address, so a rebuild gives the same tree. The leaf is the contract's: `keccak256(keccak256(abi.encode(chainid, rewards, epoch, account, amount)))`.
- **Building and funding:** `npm run rewards:epoch` (in `web/`) reads the epoch's X reach (with `X_BEARER_TOKEN`), then builds the next finished epoch and prints its root, total and per-Club lines; `--publish` sends `publish(epoch, root)` with the total from `REWARDS_OPERATOR_KEY`, first unwrapping as much of the operator's WMON (the signed-swap fees) as its MON falls short. On mainnet the operator is a Safe: build, then send the batch the script prints (`withdraw` on WMON when needed, then `publish`) from it. A build that stops part way is finished by running it again, and `npm run rewards:backup -- --export file` / `--restore file` keep each built epoch (record, proofs and the frozen inputs) outside the store and put it back after checking it against the chain ([ADR 0054](adr/0054-resumable-epoch-build-and-epoch-backup.md)).
- **Claiming:** the screens read each leaf's epoch and `isClaimed` on chain and show it as on its way (not published or not open yet), ready, claimed or expired; **Claim** sends `claimMany` for every ready leaf. Anyone may claim for an account; the MON goes to the account.
- **Reads:** `GET /api/rewards/epochs/[n]` (the whole epoch, cacheable for ever), `GET /api/rewards/me?account=` (an account's leaves with proofs), `GET /api/clubs/[token]/rewards` (the Club's line in the latest epochs, its carry, its running epoch's sponsors and top earners), `GET`/`POST /api/clubs/[token]/sponsor` (where to send MON, and recording a payment).

What rewards don't say: that an asset is good, or that a big earner is trustworthy. Faking volume to earn them loses money: each side pays the whole fee, for every NFT it gives, and at most 75% comes back, shared by the Club's active Holders. Swaps add at most 14 points (up to 20% more) to a Holder's bonus, so a Holder who trades with themselves pays real fees for a capped gain.

## Data (Upstash)

All keys start with `declub:` and are per chain.

| Key | Holds |
|---|---|
| `club:{chain}:{token}:members` | set of userIds (the join date is on the row; bounded at 2,000 so a read of every row stays one call) |
| `club-member:{chain}:{token}:{userId}` | `{wallets[], displayWallet, holder, holderCheckedAt, joinedAt}` |
| `user-clubs:{userId}` | set of tokens |
| `activity:{chain}:{token}` | zset: event JSON → block time, capped at 5000 |
| `club-posts:{chain}:{token}` | zset: postId → time, capped at 500 |
| `club-post:{chain}:{token}:{id}` | `{id, userId, wallet, kind, text, link?, at, hidden?, signed?: {signature, at}, x?: {id, author, text, postedAt, own, counted}}` (never sent as it is) |
| `club-reports:{chain}:{token}:{id}` | set of the userIds that reported the post |
| `club-reported:{chain}:{token}` | set of the post and reply ids reported since posted or last restored: the staff's Reported list (pruned when read) |
| `club-likes:{chain}:{token}:{id}` / `club-liked:{chain}:{token}:{userId}` | set of the userIds that liked the post / set of the post ids a member liked in the Club |
| `club-replies:{chain}:{token}:{id}` | set of a post's reply ids (the replies are `club-post` rows with `parent`), at most 50 |
| `active:{chain}:{token}:{n}` | set of `userId:day:postId`: posts that can make a member's day active in epoch `n` |
| `club-ban:{chain}:{token}` / `club-ban:all` | `{userId: {wallet, at, by}}`, one document each |
| `club-roles:{chain}:{token}` | `{owner?, moderators[]}`: user ids, one small document rewritten whole (staff-only, rare) |
| `club-profile:{chain}:{token}` | `{description, links[], holdersOnlyPosts, pinned[], ownerClaim?, x?: {accounts[{handle, proof, linkedAt, xUserId?}], tags[]}}` (a banner is not built yet) |
| `club-log:{chain}:{token}` | zset of log lines as JSON, scored by time (made strictly increasing), capped at 1000 |
| `momentum:{chain}:{token}` | cache |
| `wallet-posts:{chain}:{wallet}` | zset of `token:postId`, a wallet's signed posts across Clubs |
| `follow:{chain}:out:{wallet}` / `follow:{chain}:in:{wallet}` | sets: who a wallet follows / who follows it |
| `follow:{chain}:rec:{follower}:{target}` | the latest signed `Follow` between the two |
| `rewards:{chain}:epoch:{n}` | a built epoch: window, root, total, each Club's line, every leaf with its proof |
| `rewards:{chain}:epochs` / `rewards:{chain}:account:{wallet}` | zsets of epoch numbers: all built, and those that pay a wallet |
| `rewards:{chain}:carry:{club}` | `{holders, fund}` rolling into the next epoch |
| `rewards:{chain}:last` | the last epoch built |
| `rewards:{chain}:streaks:{club}` | `{userId: {n, count}}`: each member's streak, written by the epoch builder only |
| `rewards:{chain}:standings:{club}` | the live standings cache (5 minutes) |
| `rewards:{chain}:fee:{tx}` | a signed swap's settlement fee, read once |
| `rewards:{chain}:reach:{n}` | the X reach read for epoch `n`, by X post id: `{club, wallet, ok, strength, engagement, reason?}` |
| `club-rules:{chain}:{club}` | every save of the Club's reward rules: `{ from, rules, at, by }[]` ([ADR 0044](adr/0044-owner-reward-settings.md)) |
| `reward-bans:{chain}:{club}` | members banned from rewards, by userId: `{ wallet, at, by }` |
| `challenge:{chain}:{club}:list` / `…:c:{id}` | zset of a Club's challenge ids by start time (100 kept) / one challenge: title, brief, judging, prizes, window, state, settlement ([ADR 0045](adr/0045-club-challenges.md)) |
| `challenge:{chain}:{club}:entries:{id}` / `…:entry-of:{post}` | set of `postId|userId` entries / the challenge a post was entered in |
| `challenge:{chain}:{club}:awards:{n}` | challenge wins counted in epoch `n`, by userId: `{ wallet, points, wins[] }` |
| `rewards:{chain}:closing:{club}:{n}` | the frozen inputs of one Club's epoch, server-private ([ADR 0040](adr/0040-points-floor-held-average-public-backing.md)) |
| `rewards:{chain}:points:{n}` | epoch `n`'s final points for every Holder, by Club and public wallet |
| `held:{chain}:{club}:{n}` | the daily holdings samples for epoch `n` ([ADR 0040](adr/0040-points-floor-held-average-public-backing.md)): `{ days: number[], sums: { [userId]: decimal string } }` |
| `rewards:{chain}:backing:{n}` | epoch `n`'s published backing, by Club and public wallet: voices, counted actions, what a moderator's hide removed |
| `xshares:{chain}:{club}` / `xshare:{chain}:{club}:{tweet}` | zset of counted X shares by time, capped at 5,000 / each share `{tweet, club, userId, wallet, postId, at, strength, hidden?}` |
| `momentum-posts:{chain}:{club}` | zset of Holders' top-level post ids by time (up to 3 a member a day), capped at 5,000; read against the posts, so hidden and deleted ones drop out ([ADR 0047](adr/0047-board-posts-in-momentum.md)) |
| `xshare-seen:{chain}:{tweet}` | an X post that has counted, kept a year, so it never counts twice |
| `xlink:{chain}:{club}:{handle}` | a pending proof code `{code, by, until}` |

The store needed only three new operations over the whole feature (set add, remove and count). The activity log, the post ranking and the moderation log use the existing `rank` and `ranked`; roles, profile and bans are single documents. So a deleted post stays in the ranking until it falls off, and reads skip it; the cap of 500 includes such ids.

The store comment says it holds only cosmetic or rebuildable data. Memberships and posts are the first data that can't be rebuilt from the chain, and the comment changes with them. **Losing the store loses them.**

## API

Each route is a thin wrapper over a function in `web/lib/server/clubs.ts` that takes the store as a parameter, like `syncProfile` and `handlePrivyEvent`, so the logic can be tested without a server. Without a store or Privy, every route returns `{enabled:false}`, and the UI shows a "not configured" panel like the Account page's.

| Route | What |
|---|---|
| `GET /api/clubs` | `{logging, clubs}`: each Club's info, stats and `members`, busiest first (public, cached 30 s). `logging` is false when this server keeps no activity log, and then only signed swaps count. Built. |
| `GET /api/clubs/[token]` | `{logging, club, recent, holders}`: the Club's info, stats, member and holder counts and its latest 20 completed swaps. 400 for a bad address, 404 for an asset with no Club (blocked, unlisted, `club: false`, or a token that isn't a memecoin in a collection's Club). A paired asset's address serves its Club. Archived Clubs are served. Built. |
| `GET /api/clubs/[token]/members?sort=momentum\|new&page=&size=&q=` | `{enabled, members, total, matches, holders, topMomentum, page, size}` (public, cached 15 s). 400 for another `sort`, or a `page` or `size` that isn't a positive whole number (`size` at most 100), or a `q` over 64 characters. Built. |
| `GET` / `POST` / `DELETE /api/clubs/[token]/membership` | Your membership `{member, wallet?, holder?, joinedAt?, role}` / join / leave (gated). A `GET` also re-syncs your wallets. Built. |
| `GET /api/me/club-inbox` | `{items}`: likes and replies on your posts (the key carries the count, so a new one is new), your pinned posts, your X posts that counted and the rewards you earned, from the last 14 days; and, for up to 5 of your Clubs, your place in the running epoch (`club-rank`, keyed in or out) and a nudge in its last day (`club-closing`); and, for up to 10 of your Clubs, their challenges (`challenge-*`, see [Challenges](#challenges)) (gated; derived, nothing stored). The bell shows them. Built. |
| `GET /api/me/clubs` | `{clubs}`: the Clubs you belong to, leaving out ones that no longer exist (gated). Built. |
| `GET /api/timeline?scope=joined\|all\|others&limit=&before=` | `{enabled, scope, posts, next}`: a page of Board posts across Clubs, newest first, each a Board post plus its Club's `club` token. `before` is the `next` of the page before (omit it for the first); `next` is `null` at the end, so the list goes as far back as the Boards do. `joined` is the Clubs the caller belongs to (empty without a token), `all` (the default) every live Club and the caller's archived ones, `others` every live Club the caller hasn't joined. `limit` at most 50; 400 for another `scope`, a bad `limit` or a `before` that isn't a `next`. Public like each Board; cached 15 s for readers without a token. Hidden posts and replies are never listed. Built. |
| `GET /api/timeline/challenges?scope=joined\|all` | `{enabled, challenges: [{club, challenge}]}`: the challenges still running or waiting on their result ([ADR 0045](adr/0045-club-challenges.md)) in the caller's Clubs (none without a token) or in every live Club, soonest end first, pinned on top of the timeline. Settles a Club's ended ones first. Cached 15 s for readers without a token. Built. |
| `GET /api/clubs/[token]/posts` | `{enabled, posts, role}`: pinned first, then newest; hidden posts redacted. Public and cacheable for readers without a token; a reader who sends one gets a private answer that includes their own hidden posts (and, for staff, all of them with report counts). Built. |
| `POST /api/clubs/[token]/posts` | `{message, signature}`: a `Post` signed by the member's Club wallet (gated; 201). With an X link, the answer's `xShare` says whether it counted and, if not, why. Built. |
| `POST` / `DELETE /api/clubs/[token]/x` | Link the project's X account: `{action: "start", handle}` → `{code, text, until}`; `{action: "verify", handle, url}` → the profile; `DELETE {handle}` unlinks (Owner or admin). Built. |
| `GET /api/clubs/[token]/feed` | `{enabled, club, domain, types, posts, replies}`: every signed post and reply as message and signature (public). Built. |
| `GET` / `POST /api/clubs/[token]/posts/[id]/replies` | A post's replies, oldest first (public; a token adds your own hidden ones) / `{message, signature}`: a `Reply` signed by your Club wallet (gated; 201). Built. |
| `GET /api/clubs/[token]/rewards` | `{enabled, contract, epoch, endsAt, xReach, epochs, carry, earners}` (public); `xReach` says whether X engagement counts. Built. |
| `GET /api/clubs/[token]/rewards/standings?wallet=` | `{enabled, standings}`: the running epoch as if it closed now: fees and pools so far, the top 25 Holders with rank, points, NFTs, days, X shares, bonus, streak and estimate, and `me` with `gap` (points) (public, cached 60 s; private with `wallet`). Built. |
| `GET /api/rewards/epochs/[n]` | A built epoch with every leaf and proof (public, immutable). Built. |
| `GET /api/rewards/me?account=` | `{enabled, contract, epoch, endsAt, leaves}` (public). Built. |
| `GET /api/wallets/[address]/posts` / `.../follows` | A wallet's signed posts across Clubs / its signed follows and follower count (public). Built. |
| `POST /api/follows` | `{message, signature}`: a signed `Follow` from one of the caller's linked wallets (gated). Built. |
| `DELETE /api/clubs/[token]/posts/[id]` | Author, or staff who may act on the author. Built. |
| `POST /api/clubs/[token]/posts/[id]/report` | Report (gated). Built. |
| `POST` / `DELETE /api/clubs/[token]/posts/[id]/like` | Like a post, or take the like back; answers `{likes}` (gated; 409 for your own post, 409 for a hidden one). Built. |
| `POST /api/clubs/[token]/posts/[id]/hide` | `{hidden}`: hide or restore (staff). Built. |
| `POST /api/clubs/[token]/posts/[id]/pin` | `{pinned}`: pin or unpin (Owner or admin; at most 3). Built. |
| `GET` / `POST` / `DELETE /api/clubs/[token]/bans` | List (staff) / ban `{wallet \| post, everywhere?}` / unban `{wallet, everywhere?}`. Built. |
| `POST /api/clubs/[token]/claim` | Claim ownership through `owner()` (gated). Built. |
| `PUT /api/clubs/[token]/roles` | `{wallet, role: "owner"\|"moderator"\|null}`: roles are set by the member's wallet, since the public list never shows user ids. The Owner appoints Moderators (at most 10) and hands the Club over; an admin also assigns or removes the Owner. Built. |
| `GET` / `PATCH /api/clubs/[token]/profile` | Public description, links, "holders only", `x: {accounts, tags, hint}` and `coin: {token, symbol, on, min, set}` (null without a memecoin); edit, including `xTags` and `coinHolders: {on, min?}` (Owner or admin). Built. |
| `GET /api/clubs/[token]/log` | `{log, ownership}`: the moderation log (staff); `ownership` is the on-chain check, for admins only. Built. |
| `DELETE /api/clubs/[token]` | Purge a Club that is hidden from the list (admin). A live Club is refused (`not_hidden`). Deletes members, posts and their replies, roles, profile, bans, the log, the activity log, streaks, active days and the standings cache. Built. |
| `POST /api/activity` | `{hash}`, receipt-verified, rate-limited per IP. Built. |

## Code map

- **Data:** `web/data/assets.json`, `web/lib/verifiedAssets.ts` (`clubFor(token)`).
- **Server:** `web/lib/server/activity.ts` (the log), `clubs.ts` (a Club's events from the log and the pool, its summary and detail), `clubRoutes.ts` (the read handlers, built over a registry so tests can use their own list), `members.ts` (membership, Holder checks, sync, the list) and `memberRoutes.ts` (its handlers, with the caller's gate injectable for tests), `board.ts` (posts, reports, bans, roles, the claim, the profile, the purge), `boardRoutes.ts` (its handlers), `clubState.ts` (roles, profile, bans and log documents; the admin list), the store ops (`addMember`, `removeMember`, `countMembers`), and the routes under `web/app/api/clubs/` and `web/app/api/activity/`.
- **Shared:** `web/lib/momentum.ts` (the score), `web/lib/clubs.ts` (event and stats types, `summarize`, `settlementEvents`, `mergeEvents`) and `web/lib/members.ts` (`isHolder`, display wallet, stale-row picking, ranking), `clubRoles.ts` (the permission matrix, role changes) and `clubPosts.ts` (text cleaning, links, what each viewer sees, profile checks).
- **Pages:** `web/app/clubs/page.tsx` (with `parts.tsx`) and `web/app/clubs/[address]/` with `page.tsx` and `ClubMarket.tsx`, `ClubBoard.tsx`, `ClubChallenges.tsx`, `ClubMembers.tsx`, `ClubManage.tsx` (the staff tab), `ClubRewards.tsx`, `LiveStandings.tsx`, `ClubDetails.tsx` and `parts.tsx`.
- **Timeline:** `web/lib/timeline.ts` (scopes, page sizes), `web/lib/server/timeline.ts` (`listTimeline`) and `timelineRoutes.ts`, `web/hooks/useTimeline.ts`, `web/components/TimelineCard.tsx`, `TimelineComposer.tsx`, `PostComposer.tsx` (shared with the Board), `InfiniteSentinel.tsx` and `web/app/timeline/page.tsx`. `Masonry.tsx` (with `useColumns` and `toColumns`) fills a card list without gaps; the Deals, History and Market lists (`ListingGrid`) use it too.
- **Hooks:** `useClubs`, `useClub`, `useClubMarket`, `useClubMembership` (with `useMyClubs`, `useClubMembers`), `useSignIn`, `useClubBoard` (`useClubPosts`, `useClubPage`, `useClubActions`, `useClubStaff`), on React Query and `useAccessToken`. Writes report errors through `useToast`; loads use `LoadError`.
- **Components:** `ClubCard`, `ClubArt` (`clubTheme`, `ClubAvatar`, `ClubCover`), `ClubsIntro` and `ClubsTeaser` (the home page), `MomentumBadge` (with `HeatMeter`), `HolderBadge`, `JoinClubButton`, `PostItem`, `Pills`, `ActionMenu`. The directory's list row is `ClubRow` in `web/app/clubs/parts.tsx` (with `ClubListHeader` and `Leaderboard`); the Club page's collapsed details block is `ClubDetails.tsx`.
- **Rewards:** `web/lib/rewards.ts` (the split, epochs, leaves), `web/lib/server/rewards.ts` (the builder and its reads), `rewardRoutes.ts`, `web/scripts/rewards-epoch.ts` (`npm run rewards:epoch`), `hooks/useRewards.ts`, `components/RewardsClaim.tsx` (Club tab and Account) and `app/clubs/[address]/ClubRewards.tsx`.
- **Signed posts and follows:** `web/lib/social.ts` (typed data, drafts, parsing), `web/lib/lenses.ts`, `web/lib/server/follows.ts`, `socialRoutes.ts`, `createSignedPost` / `exportPosts` / `walletPosts` in `board.ts`, `hooks/useSocial.ts` (`useSocialSign`, `useFollows`) and `components/FollowButton.tsx`.
- **X posts:** `web/lib/xPosts.ts`, `web/lib/server/xPosts.ts`, `xApi.ts`, `xReach.ts`, the card in `components/PostItem.tsx`, the Owner's panel in `ClubManage.tsx`.
- **Challenges:** the rules in `web/lib/challenges.ts` (`checkChallenge`, `JUDGING`, the winner pickers and the raffle draw); the store logic in `web/lib/server/challenges.ts`, its keys in `challengeState.ts` and the prize checks in `challengePrizes.ts`; `hooks/useChallenges.ts`; the card and its parts in `components/ChallengeCard.tsx`, the Owner's form in `app/clubs/[address]/ClubChallenges.tsx` and the page in `ChallengeDetail.tsx` and `challenges/[id]/page.tsx`. Sharing: `web/lib/challengeShare.ts` (the X post text), `components/ChallengeShare.tsx`, the card image in `challenges/[id]/opengraph-image.tsx` (read by `web/lib/server/challengeCard.ts`) and the link preview in `challenges/[id]/layout.tsx`. Trophies on a profile: `components/profile/ProfileTrophies.tsx`. The bell's challenge news is `challengeNews` in `web/lib/server/inbox.ts`.
- **Reused:** `featuredCollections` and `useCollectionInfos` for names, `useTokenInfo` for ERC-20s, `loadMetadata` for art.

## Build order

1. **Built:** `assets.json` and its loader (`lib/verifiedAssets.ts`), `momentum.ts`, `activity.ts` with `/api/activity` and `reportTx`, and the first `web` tests. The store ops come with the steps that use them.
2. **Built:** the read-only Club pages (`/clubs`, `/clubs/[address]` with the Market tab and Momentum), `GET /api/clubs` and `/api/clubs/[token]`, the matcher's `token=` and `after=` filters, and the nav link.
3. **Built:** membership (join, leave, `GET /api/me/clubs`), the Holder badge, the Members leaderboard, "Your Clubs", and wallet sync from the Privy webhook, the profile route and signed-in loads.
4. **Built:** the Board (posts, reports that flag a post for the moderators), roles (the `owner()` claim, Moderators, handing over), bans, pins, the Club page, the moderation log and the admin tools (global bans, purge). The banner image is left for later.
5. **Built:** the user guide ([07](07-user-guide.md#clubs-and-momentum)), the frontend notes ([05](05-frontend.md#clubs)) and this page.

**Not built yet:** bell notifications for a Club's new deals (likes, pins and rewards are in the bell), the in-app request queue, moderators chosen by holders, cross-Club reputation on the profile, Clubs for unverified assets.

## Testing

`web` has `npm test` (`node --test`, like `matcher/`), set up in `web/test/register.mjs`, which adds extensionless imports and the `@/` alias to Node's own TypeScript support. It needs Node 24 or later. Tests cover:

- `momentum.ts`: decay, caps, wash damping, trend.
- `ingestTx` against recorded receipts, including replay.
- `clubs.ts` on the in-memory store: join and leave, holder recheck, post limits, the report threshold, bans, each role's permissions (a Moderator can't ban the Owner, the Owner can't leave without handing over), the `owner()` claim with a stubbed read, and an archived Club refusing writes.
- The matcher's `token=` filter, in `matcher/test/server.test.ts`.
- Rewards (`test/rewards.test.ts`): the Merkle tree, epochs, the leaf against the contract's encoding (and a root the contract verifies, `DeClubRewards.leafFixture.t.sol`), the split and carry, the builder (fees per Club, shares by holdings, a swap in two Clubs, signed-swap fees, order and idempotency, unreadable balances) and the routes.
- Signed posts, follows and lenses (`test/social.test.ts`), with real signatures: what is refused and why, replay, the exports verifying, follow and unfollow, each lens alone and on the Board.
- The timeline (`test/timeline.test.ts`): joined, all and others, archived Clubs, hidden posts and replies left out for everyone, likes and the reader's own like, cursor paging (no cap, no repeats, the same list at any page size, past a page of hidden posts), the masonry columns, and the route's cache and bad input.
- X posts (`test/xPosts.test.ts`): link parsing and the canonical form, signals and their strength, the oEmbed and X API readers, each X-share rule, hide and delete, Momentum, linking the project's account by proof, the reach read and the Holder bonus (bounds, the cap, splitting accounts, the builder).

By hand, with two wallets on Monad testnet:

1. Mint a Mock Chog to the first wallet from the command line (`MockChog.mint(to, quantity)`; the app has no mint screen), sign in, join the Mock Chog Club, and see the Holder badge.
2. Create a deal and fill it from the second wallet.
3. Check "Recent swaps", Club Momentum going up, and both members on the leaderboard.
4. After the epoch ends (set `NEXT_PUBLIC_REWARDS_EPOCH_SECONDS` short), run `npm run rewards:epoch -- --publish`; the Holder and the Owner each see their share on the Rewards tab and claim it.
5. Post a signed note, follow the other member, switch the Board's lens, and fetch `/api/clubs/<address>/feed`.
6. As the Owner, link an X account you control by its proof post; then, as a Holder, share your own X post that mentions it: the card says it counts, and Momentum rises.
7. Post a "Looking for" linked to a deal, report it from 3 accounts and see it hidden, then delete it as admin.
8. Turn Privy off and see the not-configured state.
