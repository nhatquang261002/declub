# Plan: make Club points hard to game (ADR 0040)

**Status:** Built · 2026-10-07. Web only, no contract change. It builds on the uncommitted ADR 0038 (points from backing) and ADR 0039 (base voice) work on `develop`. Now recorded as [ADR 0040](../adr/0040-points-floor-held-average-public-backing.md).

## Why

We asked whether members can cheat the points that decide the Holder pool. They can:

| # | Hole | How bad |
|---|---|---|
| 1 | **Like rings of three or more** avoid the half-credit rule, which only catches pairs (A↔B). Ten 1-NFT accounts backing each other in a loop can take every paid seat in a quiet Club. | Serious |
| 2 | **More accounts, more voice.** Voice is capped at 5 NFTs per account, so the same NFTs spread over many accounts give more voice, and each verified account adds 3 base voice. | Serious |
| 3 | **Holdings are read once, at build.** Buying or borrowing NFTs just before close gets full voice and a full share. | Serious |
| 4 | **Three Holder reports hide a post**, and a hidden post's backing counts for nothing, so a group can strip a rival's points. | Serious |
| 5 | **Swap points by rotating partners.** Only a repeat counterparty is halved. | Moderate |
| 6 | **Staff can hide rivals' posts** and remove their points. | Moderate |
| 7 | **Likes aren't signed**, so the operator is trusted for backing totals. | Moderate |

## Decisions

- **Pay by a points floor, not 10 seats.** Every Holder with at least `minPoints` (10) is paid, split by NFTs × (1 + bonus). Rings and split accounts were only worth it because there were seats to push real Holders out of. Without seats, they earn about what their NFTs would earn honestly.
- **No cycle discount.** A backing graph can't tell a ring from a tight-knit Club, and any discount on returned backing penalizes giving back.
- **Average holdings over the week**, for both the voice and the share of the pool.
- **Only Moderators and above can hide posts.** Reports just flag a post for them.
- **Publish who backed whom** after each epoch, so anyone can recompute the points.
- **Swaps: no change.** Under the floor they only feed the bonus.

## Upcoming features this has to fit (not built here)

- **A timeline page:** Board posts from many Clubs in one feed, where people like, reply and report without opening each Club.
- **Owner settings:** each Club's Owner sets its own thresholds (the floor, voice, weights and so on).

Everything below is shaped so neither needs rework. See [Ready for what's next](#ready-for-whats-next).

---

## Changes

### 0. Rules as data, not constants

So Owners can set thresholds later without touching the scoring code.

- `web/lib/rewards.ts`: split `REWARDS` into:
  - **Protocol rules** (Owners can't change them, because they cross Clubs or the contract fixes them): `holderBps`, `fundBps`, `protocolBps`, `maxBonusBps`, `maxStreakBps`, `baseVoice`, `verifiedDays`, `baseCapPerReceiver`.
  - **`ClubRules`**: `minPoints`, `fullBonusPoints`, `dayPoints`, `voicePerNft`, `voiceCapNfts`, `likeWeight`, `replyWeight`, `firstReplyWeight`, `mutualFactor`, `swapPoints`, `swapCapPerEpoch`, `streakMinDays`, `streakStepBps`. Defaults go in `DEFAULT_CLUB_RULES` and allowed ranges in `CLUB_RULE_BOUNDS`, for the future settings form.
- The pure functions take `rules: ClubRules = DEFAULT_CLUB_RULES`: `paidPlaces`, `entryGap`, `splitClub` (via `ClubInput.rules`), `activityPoints`, `backingPoints`, `voiceOf`, `bonusBps`, `qualifies`. `REWARDS` stays as an alias of the defaults, so existing callers and tests keep working.
- New `web/lib/server/clubRules.ts` with `rulesFor(store, club, n)`, the only source of rules for the builder and the standings. Today it returns the defaults. Later it will read the Owner's saved rules, where **a change saved in epoch n takes effect in n + 1**, so an Owner can't move the floor in a race already under way.
- Publish the rules used in `EpochRecord.clubs[].rules` and `ClubStandings.rules`. `LiveStandings`, `PointsMeter`, `ClubRewards` and the footnote read numbers from `standings.rules` instead of `REWARDS.*`. The Guide keeps saying "by default…".

### A. Points floor replaces the 10 seats (#1, #2)

- `paidPlaces(ranked, rules)` keeps every ranked Holder with `points >= rules.minPoints`. `rankHolders` stays as the leaderboard order.
- `entryGap` becomes `max(0, minPoints − points)`, or `null` when the member isn't ranked.
- `standings.ts`: `ROWS_SHOWN` becomes a fixed 25, no longer tied to `maxHolders`.
- `LiveStandings.tsx`:
  - The headline says "For every Holder with {minPoints}+ points", and the subline "Holders with {minPoints}+ points are paid".
  - The chip "Outside the top 10" becomes "Below {minPoints} points".
  - The hint says "About N more points and you're paid".
  - The podium stays as a leaderboard.
- Copy: the How panel in `ClubRewards.tsx`, the Guide, docs 07, 09, 11 and 13, and the README.
- **Example** (10 MON pool):

  | | NFTs | Points | Bonus | Weight | Gets |
  |---|---|---|---|---|---|
  | A | 12 | 40 | +50% | 18 | 4.88 |
  | B | 3 | 20 | +29% | 3.86 | 1.05 |
  | C | 1 | 5 | below floor | 0 | 0 |
  | Ring of 10 | 1 each | 35+ | +50% | 1.5 each | 0.41 each (4.07 total) |

  The ring gets what 10 honestly held NFTs would earn, and can't push A or B out.
- **Residual risk:** a ring can still give itself the full bonus, which is at most +50% on its own NFTs.

### B. Holdings averaged over the week (#3)

- New `web/lib/server/held.ts`:
  - `heldKey(club, n)` is `declub:held:{chain}:{club}:{n}` and stores `{ days: number[]; sums: Record<userId, string> }`.
  - `sampleHoldings(store, clubs, holdings, now)` runs once per UTC day per Club. It reuses `holderShares` from `web/lib/server/rewards.ts` (now exported) and skips a day already sampled.
  - `readHeld(store, club, n)`.
- New `web/app/api/cron/holdings/route.ts`, using the same pattern as `cron/fills` (`CRON_SECRET`, `cronAuthorized`). Add `web/vercel.json` with a daily cron; Vercel Hobby's daily limit is enough.
- `holderInputs`:
  - `held = sum + read at close` and `count = days.length + 1`. Days before someone joined count as 0.
  - Voice is `voiceOf(held / count)`. A member sampled this epoch keeps that voice even if they sold before close.
  - **With no samples, `count` is 1, which matches today's behaviour** (tests, demos, no cron).
- `splitClub` weight becomes `(held ?? shares) × (10000 + bonus)`. This is exact, because every Holder in a Club has the same sample count. Being paid still needs at least 1 NFT at close.
- Publish `held` (average NFTs, 2 decimals) on payouts and standings rows, and `samples` per Club. MyCard and the rows show the average when it differs from the current count.
- `purgeClub` also deletes `heldKey`.
- **Example:** buying 5 NFTs on the last day gives an average of 5/7 ≈ 0.7, so a voice of about 7 instead of 50 and a weight of about 0.7 instead of 5.
- **Residual risk:** the sample time is predictable, so a borrow could be timed around it. Randomizing the hour comes later.

### C. Only Moderators and above hide posts; reports just flag them (#4)

- `reportPost` (`web/lib/server/board.ts`):
  - Drop the `REPORTS_TO_HIDE` auto-hide and its `auto_hide` log entry.
  - Reports are still kept, the post is marked `reported: true`, and Holder reports are still counted separately (`countedReportsKey`) so staff can weigh them.
- Add a per-Club **"Reported" list** on the Manage tab (unless one exists), since reports will also come from the timeline.
- Remove `REPORTS_TO_HIDE` (`web/lib/clubPosts.ts`) and the copy that uses it:
  - `ClubBoard.tsx`: the copy becomes "reports go to the moderators".
  - The Guide's report section.
  - The report route's comment.
  - Keep the `auto_hide` label in `ClubManage.tsx` so old log entries still read correctly.
- Old posts with `hidden: "reports"` stay hidden until staff act, and `HiddenBy` keeps `"reports"`. For points, only a moderator hide counts: `removedForRewards(post) = post.hidden === "moderator"` is used in `backing.ts` (`standing`, the parent check, `firstReplies`) and in `activeDays.ts`.

### D. Staff hides are visible (#6)

Staff keep the power to hide, because moderation is needed. The published backing (E) lists actions dropped by a moderator hide as `removed`, so the loss can be seen and matched to the moderation log.

### E. Publish who backed whom (#7)

- `holderInputs` also returns the epoch's standing actions and voices.
- `compute` maps user ids to public wallets: the member's display wallet, or for a non-member verified giver, their profile wallet.
- It stores `{ [club]: { voices: Record<wallet, Voice>, actions: {from, to, kind}[], removed: {from, to, kind, by: "moderator"}[] } }` at `backingRecordKey(n)`, kept apart from the `EpochRecord` so that stays small.
- New `GET /api/rewards/epochs/[n]/backing`.
- **Trade-off:** likes become public once an epoch closes. The Guide says so.

### F. A re-like can't farm active days (found during the review)

`standing()` sorts entries by day and counts a like's day only for the first (post, giver) entry.

### G. Swaps (#5): no change

Under the floor, swap points only feed the bonus (at most 14 of 35), and every swap pays the fee. The ADR records why.

---

## Ready for what's next

**Timeline page**
- Everything stays keyed by the post's Club: backing, held samples, reports, moderation and the published backing. A like, reply or report from the timeline lands exactly as it would on the Club page.
- The cross-Club parts are already protocol-wide: the base voice is shared over everything given in every Club (`givenEverywhere`), and the per-receiver base cap is a protocol rule.
- Timeline reports reach that Club's Moderators through the Manage "Reported" list.
- Auto-join on a first like or reply fits the held average: samples count from joining, and a member without NFTs carries no NFT voice.

**Owner settings**
- They only add storage, a Manage form checked against `CLUB_RULE_BOUNDS`, and the "takes effect next epoch" rule. Everything else reads `rulesFor()`.
- Rules are published per epoch and in the standings, so members see their Club's rules and outsiders can recompute payouts.
- Owners can't change the fee split, the bonus caps or the base voice.
- Hiding stays with Moderators and above. That's a protocol rule, because hiding moves points.

## Order of work

1. Step 0, rules as data, with no behaviour change. Tests stay green.
2. A, the floor, with its copy.
3. C and F, moderation-only hides and the re-like fix.
4. B, the held average and the cron.
5. E and D, the published backing.
6. Docs: ADR 0040, the ADR README (0037 amended, 0038's status line, 0016's report rule), docs 07, 09, 11 and 13, the README, the Guide, and the memory note.

## Verification

- Unit tests (`web/test/`):
  - **Floor:** a ring of ten 1-NFT accounts and one 12-NFT Holder are all paid; at equal bonus the ring gets 10/22 of the pool. `entryGap` is measured against the floor.
  - **Rules:** a custom `minPoints: 20` changes who's paid; the defaults reproduce today's numbers; `EpochRecord.clubs[].rules` is present.
  - **Held average:** buying on the last day gives about 1/7 of the voice and the weight; with no samples the results match today's; the cron samples once a day.
  - **Reports:** five reports leave a post visible and `reported`; a moderator hide removes its points and a restore brings them back; an old `"reports"`-hidden post still counts.
  - **Re-like:** liking again on a second day adds no day.
  - **Published backing:** recomputing it through `backingPoints` gives the published `backed` values.
- From `web`: `npm test`, `npm run typecheck`, `npm run lint`.
- Manual:
  - Call `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/holdings` twice; the second call skips.
  - The Rewards tab shows the floor copy and the average NFTs.
  - `GET /api/rewards/epochs/<n>/backing` returns data after a local build.

## Still open

- **Floor value:** 10 points means a fully active week of taking part (7) plus a little backing. Owners will be able to change it later.
- **When to randomize the sample hour:** it needs a scheduler that runs more often than once a day.
- **Members without a `since` on their profile:** whether to treat them as verified long enough (carried over from ADR 0039).
