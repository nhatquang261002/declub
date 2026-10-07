# ADR 0044: Owners set how their Club pays, with a ramp instead of a floor

**Status:** Accepted · 2026-10-07 · Web only: no contract change. Amends [ADR 0040](0040-points-floor-held-average-public-backing.md) (the 10-point floor becomes a ramp, and the paying rules become the Owner's) and the bonus cap of [ADR 0024](0024-x-posts-and-the-holder-bonus.md) (+50% becomes +25%). The spec is [09 · Clubs](../09-clubs.md#rewards).

## Context

ADR 0040 paid every Holder with at least 10 points. Two problems came up:

- **A floor doesn't stop bots.** Ten points is a week of active days and one like, which a bot reaches cheaply. What limits a bot is that payouts follow NFTs held; the floor only filters out quiet Holders.
- **A fixed floor hurts small Clubs.** Points come mostly from backing, and backing is bounded by how many Holders a Club has and how much voice they carry. In a Club of three 1-NFT Holders, two who back each other get about 5 points each from it; a higher floor, or a floor of backing only, can't be reached at all.

Paying the top N instead has its own problems (a ring of cheap accounts can take every seat and push real Holders out, and the cutoff is a cliff that swings late), but some Owners want it for their Club. No single rule fits every Club, so the Owner chooses, within bounds, and the protocol keeps the parts that limit farming.

## Decision

- **A ramp, not a cliff.** A Holder's weight is NFTs held (averaged, ADR 0040) × (1 + bonus) × `min(1, points / rampPoints)`. `rampPoints` defaults to 5. Below it a Holder is paid part of their share (half at half the points); at least `PROTOCOL.minPaidPoints` (1) is needed to be paid at all. There's no number where one more point jumps from nothing to everything.
- **The Owner sets the paying rules, and only those** (`OWNER_RULES`; `PATCH /api/clubs/[token]/rules`, the Manage tab's Rewards panel), each checked against `CLUB_RULE_BOUNDS` (`checkRules`):
  - `rampPoints` (1–100).
  - **Who is paid:** `maxPaid`, at most this many Holders (0 is no limit), and `maxPaidPercent`, at most this share of the Club's Holders, rounded up and at least one (100 is no limit). The most active first, a tie to the bigger holding. Both default to no limit.
  - **Members without NFTs:** `nonHolderBps`, a slice of the Holder pool (0–30%, off by default) split among members without NFTs by their points (counting up to `fullBonusPoints`). Holders share the rest by NFTs as before, so the most an account farm with no NFTs can take is that slice. With no member earning any, it stays with the Holders.
  - **Not how points are counted.** Voice, backing weights, mutual backing, the pair cap, day and swap points, streaks and the bonus curve stay the defaults in every Club: a Club's points mean the same as another's, the published backing can be checked with one set of rules, and an Owner (usually a Holder too) can't tune the counting toward themselves. A save can't carry them (`ownerRulesOf`).
  - A change saved in epoch `n` applies from `n + 1`, and a second change in the same epoch replaces the first. Every save is kept (`declub:club-rules:{chain}:{club}`), logged (`edit_rules`, with what changed), and the rules each epoch used are published with it.
- **The Owner can ban a member from rewards** (`POST`/`DELETE /api/clubs/[token]/reward-bans`, by Club wallet; an app admin too; only someone who outranks them). A banned member stays in the Club but isn't paid, and their likes and replies give nobody points. It applies to every epoch not yet closed, the running one included. Logged (`reward_ban`, `reward_unban`), published per epoch (`excluded`), and what the banned member gave is listed in the published backing as `removed` with `by: "reward_ban"`.
- **Less to farm, for every Club:**
  - The activity bonus is at most **+25%** (`PROTOCOL.maxBonusBps`, was +50%): the bonus is the one part of a payout accounts alone can farm.
  - **A pair cap:** one member gives another at most `pairCap` (20) points an epoch, NFT and base voice together, so two accounts can't pump each other.
- **Payouts to members without NFTs** are `kind: "member"` in the leaf breakdown; the epoch publishes `paidMembers` and `memberCount`, and the points ledger lists them with `holder: false`.

## Consequences

- An Owner can make their Club pay only its top few Holders, with the risks of seats (ADR 0040's hole #1) in that Club. It's their choice, it's published, and it can't reach other Clubs: the fee split, the bonus caps, the base voice and who may hide posts stay protocol rules.
- An Owner is usually a Holder too and could tune the rules toward themselves, or ban rivals from rewards. Mitigations: rules only change from the next epoch, every change and ban is in the Club's log and published with the epoch, and bans need the Owner to outrank the member.
- The ramp pays a little to Holders with a point or two, which moves slightly toward "holding pays"; `rampPoints` sets how far.
- Moderators can read the bans but not change them or the rules.
