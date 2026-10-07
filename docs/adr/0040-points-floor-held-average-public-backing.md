# ADR 0040: A points floor, holdings averaged over the week, and public backing

**Status:** Accepted · 2026-10-07 · The floor is replaced by a ramp, and the rules became the Owner's, in [ADR 0044](0044-owner-reward-settings.md). · Web only: no contract change. Amends [ADR 0037](0037-most-active-holders-are-paid.md) (the 10 paid places become a points floor), [ADR 0038](0038-points-from-backing.md) (what removes a post's backing, and when voice is read) and the report rule of [ADR 0016](0016-clubs-and-momentum.md) (reports no longer hide a post). The spec is [09 · Clubs](../09-clubs.md#rewards). The plan it came from is [plans/0040-hard-to-game-points.md](../plans/0040-hard-to-game-points.md).

## Context

Since ADR 0038 most of a member's points come from other members' backing, and the 10 Holders with the most points share the Holder pool. We asked whether members can cheat that, and they can:

| # | Hole | How bad |
|---|---|---|
| 1 | **Like rings of three or more** avoid the half-credit rule, which only catches pairs. Ten 1-NFT accounts backing each other in a loop can take every paid seat in a quiet Club. | Serious |
| 2 | **More accounts, more voice.** Voice is capped at 5 NFTs per account, so the same NFTs spread over many accounts give more voice, and each verified account adds 3 base voice. | Serious |
| 3 | **Holdings are read once, at build.** Buying or borrowing NFTs just before close gets full voice and a full share. | Serious |
| 4 | **Three Holder reports hid a post**, and a hidden post's backing counts for nothing, so a group could strip a rival's points. | Serious |
| 5 | **Swap points by rotating partners.** Only a repeat counterparty is halved. | Moderate |
| 6 | **Staff can hide rivals' posts** and remove their points. | Moderate |
| 7 | **Likes aren't signed**, so the operator is trusted for backing totals. | Moderate |

## Decision

- **Pay by a points floor, not 10 seats.** Every Holder with at least `minPoints` (10) points is paid, split by NFTs × (1 + bonus). Rings and split accounts were only worth it because there were seats to push real Holders out of. Without seats they earn about what their NFTs would earn honestly. (#1, #2)
- **No cycle discount.** A backing graph can't tell a ring from a tight-knit Club, and any discount on returned backing penalizes giving back.
- **Average holdings over the week**, for both the voice and the share of the pool. Once a UTC day each Club's members' NFTs are read (`/api/cron/holdings`); the builder adds the read at close and divides by the number of reads. A day before someone joined counts as zero, and a member who held NFTs during the week keeps that voice even if they sold before close, though being paid still needs at least one NFT at close. With no samples the average is the holding, as before. (#3)
- **Only Moderators and above hide posts.** Reports flag a post for them (the Manage tab's Reported list) and are counted apart for Holders and staff, so staff can weigh them, but nothing is hidden. Only a moderator's hide removes a post's backing and its active days; a post that reports hid before this change stays hidden until staff act, and still counts. (#4)
- **Publish who backed whom** after each epoch (`GET /api/rewards/epochs/<n>/backing`): every like and reply that counted, by public wallet, the voices they were given with, and what a moderator's hide removed. With the epoch's rules anyone can recompute the points through `backingPoints`. Likes become public once an epoch closes. (#6, #7)
- **A like taken back and given again can't farm active days.** A like's day counts once, on the first day it was given. (found in the review)
- **The epoch's inputs are frozen when it closes.** Until now the build read everything live, so a like taken back, a post deleted or a moderator's hide after the epoch ended (before the build ran) changed the result, and the old result couldn't be reproduced. `/api/cron/close` (daily, 00:10 UTC) freezes each Club's inputs for the epoch that just ended (`closeEpoch`): the holdings read and average, the backing and active days that still stood, the rules, and who backed whom. The builder scores from that snapshot (`scoreHolders`) and closes any Club the job missed, so the build never depends on the job. What the chain and X say (swaps, X shares and their reach) is still read when the epoch is built. The freeze time is published (`EpochRecord.clubs[].closedAt`). A moderator can't undo a hide that came after the close until the next epoch: that is the price of a predictable result, and the day between publishing and claims is still the window to catch a mistake.
- **A final points ledger.** The build also stores every Holder's final points, paid or not, with the breakdown (days, X, swaps, backing, bonus, streak, average NFTs) and the rules: `GET /api/rewards/epochs/<n>/points`, by public wallet, with no user ids. A member's history and anyone's recomputation read it. Non-Holders with active days keep their streak but have no row.
- **Swaps: no change.** Under the floor they only feed the bonus (at most 14 of 35), and every swap pays the fee. (#5)
- **Rules are data.** The thresholds an Owner may later set (`minPoints`, `fullBonusPoints`, `dayPoints`, `voicePerNft`, `voiceCapNfts`, the backing weights, `mutualFactor`, `swapPoints`, `swapCapPerEpoch`, `streakMinDays`, `streakStepBps`) are a `ClubRules` value with `DEFAULT_CLUB_RULES` and `CLUB_RULE_BOUNDS`; the rest (the fee split, the bonus caps, the base voice, the X weights) is `PROTOCOL`. `rulesFor(store, club, n)` is the only source; today it returns the defaults. A change an Owner saves in epoch `n` will take effect in `n + 1`. The rules used are published in each epoch (`EpochRecord.clubs[].rules`) and in the live standings.

### Worked example

A 10 MON fee pool, 5 MON to Holders:

| | NFTs | Points | Bonus | Weight | Gets |
|---|---|---|---|---|---|
| A | 12 | 40 | +50% | 18 | 4.88 |
| B | 3 | 20 | +29% | 3.86 | 1.05 |
| C | 1 | 5 | below floor | 0 | 0 |
| Ring of 10 | 1 each | 35+ | +50% | 1.5 each | 0.41 each (4.07 total) |

The ring gets what 10 honestly held NFTs would earn, and can't push A or B out.

## Consequences

- Rings and split accounts earn about what their NFTs would, at most the full +50% bonus on them. That bonus is the residual risk.
- The sample time is predictable (daily, 00:05 UTC), so a borrow could be timed around it. Randomizing the hour needs a scheduler that runs more often than Vercel Hobby's daily cron.
- The floor value (10: a fully active week of taking part is 7, plus a little backing) is a default Owners will be able to change.
- Moderators have more weight: a hide is the only way points move, and every hide is logged and its effect published.
- A timeline of posts from many Clubs and Owner settings fit without rework: everything stays keyed by the post's Club, and an Owner's settings only add storage, a form checked against `CLUB_RULE_BOUNDS` and the "next epoch" rule.
- Needs a redeploy of the web app and a `CRON_SECRET` for the daily sample and the close (`web/vercel.json`). No contract change.
