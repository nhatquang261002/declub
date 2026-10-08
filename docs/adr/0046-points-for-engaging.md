# ADR 0046: Members earn points themselves for engaging with others

**Status:** Accepted · 2026-10-07 · Web only: no contract change. Adds to [ADR 0038](0038-points-from-backing.md) (backing goes to the receiver) and the "likes earn the giver nothing" rule of [ADR 0030](0030-likes-club-inbox-and-recap.md). The spec is [09 · Clubs](../09-clubs.md#rewards).

## Context

Since ADR 0038 a like or a reply is worth a lot to the member who receives it (backing) and almost nothing to the one who gives it: one active day, which a single post earns as well. Giving engagement is what makes the Board feel like a club, and the giver sees no reward for it. The user wants members to engage with each other, and the giver to earn something small for it, at most 5 a week.

Paying per action invites farming: a script that likes every post would climb. Points also decide shares of a fixed pool, so whatever engagement points are paid comes out of everyone else's share.

## Decision

A fifth part of a member's activity points, **engaging** (`engagementPoints`):

- **1 point for each other member they replied to** (`engageReplyPoints`, a first reply counts as a reply) and **0.5 for each member they only liked** (`engageLikePoints`).
- **Counted per member, not per action.** Fifty likes on one member's posts earn what one does; a reply to them earns 1 however many replies follow. Engaging with many different members is what pays.
- **At most 5 an epoch, per Club** (`engageCapPerEpoch`), so it rewards the habit and can't carry the race. Five replies to five members, or likes for ten, reach it.
- **No voice needed.** Members without NFTs earn it too, like active days; it matters to them only where the Club pays them a slice (ADR 0044).
- **Same record and checks as backing.** Read from the epoch's recorded likes and replies (`readBacking`): a like taken back, a deleted or moderator-hidden post or reply, an action on oneself (one user id across linked wallets), and anything a member banned from rewards gave count for nothing. Frozen at the close in `ClosingHolder.engaged`.

The three rules sit with the point-counting rules in `ClubRules`, the same in every Club; Owners can't change them.

## What it does not do

- **It doesn't stop a ring.** Six accounts replying to each other each reach the cap. That is at most 5 points each, the same as the cap, and they still need NFTs (and the ramp) to be paid from the Holder pool; their mutual backing is halved as before.
- **It doesn't weigh who was engaged with.** Liking a new member counts the same as liking the Owner.
- **It adds no record.** Nothing new is stored or published: the backing published per epoch already lists every action, so anyone can recompute it.

## Consequences

- Liking and replying across the Club is worth up to 5 points to the giver, on top of the active day. With the default ramp of 5 points, a Holder who replies to five members has their whole share.
- The Points meter shows an **Engaging** line, the live standings and the epoch ledger carry `engagedPoints`, and the Rewards footnote and the Guide say how it's earned.
- Tests cover counting members not actions, a reply beating a like, the cap, oneself, members without a voice, and the Holder inputs.
