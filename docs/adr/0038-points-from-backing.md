# ADR 0038: Points come from what other Holders back, not from counting your own actions

**Status:** Accepted · 2026-10-07 · Amended by [ADR 0039](0039-base-voice-for-verified-accounts.md) (verified accounts get a small base voice) and [ADR 0040](0040-points-floor-held-average-public-backing.md) (voice follows holdings averaged over the week, only a moderator's hide removes backing, and backing is published). Web only: no contract change. Amends the active-day rule of [ADR 0032](0032-live-standings-active-days-and-replies.md) ("a day with a top-level post", "replies earn nothing") and the Board's "likes are not a score" rule. Ranking by points ([ADR 0037](0037-most-active-holders-are-paid.md)), swap points ([ADR 0034](0034-swaps-count-in-the-holder-bonus.md)) and X shares ([ADR 0024](0024-x-posts-and-the-holder-bonus.md)) stay. The spec is [09 · Clubs](../09-clubs.md#rewards).

## Context

Since ADR 0037 a place among the paid 10 is won by activity points, and the points only counted what a member did: a post a day, an X share, a swap. That has three problems:

- **Effort isn't value.** A one-word post a day earns the same 14 points as a useful one, and nobody has to read it.
- **It saturates.** Most active members end on the same few totals, ties fall back to the bigger holding, and the race is decided by the bag again.
- **It rewards broadcasting, not community.** Nothing pays a member for answering someone else, welcoming a newcomer, or being worth listening to.

What a community wants more of is members engaging with each other. The Board already has likes and replies.

## Decision

A member's points are four parts, and the ranking and the bonus read the total as before:

1. **Backing (most of the points).** Each Holder has a **voice** of `voicePerNft` (10) points per NFT they hold, counting at most `voiceCapNfts` (5) NFTs, so 10 to 50 points a week. It is shared out over the likes and replies they gave in the Club that epoch: a like weighs `likeWeight` (1), a reply `replyWeight` (2), and the **first reply** on a post from anyone but its author `firstReplyWeight` (4). Whatever a member's posts and replies received is their backing. A Holder who backs one post gives it all of their voice; one who likes fifty gives each a little. Voice that isn't given is lost at the end of the epoch.
2. **Taking part (a small floor).** `dayPoints` (now 1, was 2) per **active day**, at most 7: a UTC day with a visible post, a reply, or a like on another member's post in the Club. Replying and liking now count, so reading the Board and answering is enough to keep the habit and the streak.
3. **Swaps:** unchanged (2 each, half for a repeat counterparty, at most 14).
4. **X shares:** unchanged (3 each, plus reach when `X_BEARER_TOKEN` is set).

Guards:

- **Only Holders' voice counts.** A member without NFTs can like and reply, and it counts toward their own active day, but it carries no voice. Getting backing costs someone real NFTs.
- **Voice is linear in NFTs up to the cap**, so splitting NFTs over many wallets gains nothing below 5 NFTs a wallet. Each wallet also has to be a separate joined member.
- **Nobody backs themselves.** You can't like your own post. A reply to your own post, and any action between the same user's linked wallets, carry nothing (one user id holds all their wallets).
- **Mutual backing counts half** (`mutualFactor`): if A and B both backed each other in the epoch, each direction counts at half, so pairs and rings that trade likes get less.
- **It is read when the epoch is read.** A like that was taken back, a hidden or deleted post or reply, and a reply to a hidden post count for nothing, as for active days.
- **The voice uses the same balance read as the shares**, when the epoch is built, so it moves with holdings like everything else.

`fullBonusPoints` (35) and `maxBonusBps` (+50%) don't change, and neither does the split among the paid (shares × (1 + bonus)).

### Worked example

Four Holders: A and B hold 4 NFTs (voice 40), C holds 2 (voice 20), D holds 1 (voice 10).

- A likes one of B's posts and writes the first reply on C's post: weights 1 + 4. B gets 40 × 1/5 = 8, C gets 40 × 4/5 = 32.
- B likes one of A's posts: A gets 40. A and B backed each other, so both directions count half: A gets 20, B gets 4.
- D likes one post each from A and C: 5 each.
- C gives nothing; their 20 of voice is lost.

Backing: A 25, B 4, C 37, D 0. With one active day each (A, B and D gave; C posted), the totals are A 26, B 5, C 38, D 1. C, who started the conversation and got the first reply, leads, and D, who only liked, is last but still paid.

## Recorded

Each like and reply is recorded against the epoch it was given in (`web/lib/server/backing.ts`, `declub:backing:{chain}:{club}:{n}`), with its day. Reading checks it is still there; `holderInputs` turns it into backing (`backingPoints`) and active days.

## What it does not do

- **Likes aren't signed.** Posts and replies are, but a like is one tap and asking for a signature on each would stop people liking. The builder's backing totals can't be checked against signatures the way posts can; they are published per Holder (`backed` in the breakdown) and the operator is trusted for likes. Replies, which weigh more, are signed.
- **It doesn't stop a big Holder backing friends.** A 5-NFT Holder's 50 points can lift a few members. That is visible on the Board, capped at 5 NFTs of voice, and halved if returned.
- **It doesn't weigh old posts less.** A like on an older post counts in the epoch it is given; the voice budget, not the post's age, limits it.
- **The Board doesn't show voice.** Posts still show like and reply counts, not points, so members aren't asked to chase a number.

## Consequences

- **A quiet Board is a quiet race.** With few Holders giving, backing is small and the floor, swaps and X shares decide more, as before.
- **Liking and replying are now worth doing for the giver** (their active day) and worth a lot to the receiver, which is the behaviour the Club wants.
- **Copy changed** on the Rewards tab (points breakdown, hints, the footnote), the Guide, the inbox nudges and the Board's likes comment.
- **Tests** cover the split of a voice, the first-reply weight, the cap, mutual backing, takeback and hiding, active days from likes and replies, and the standings breakdown.
