# 13 · Why communities move, and how we grow

This page answers two questions the product spec leaves open: why would a Monad NFT community start using DeClub when it already has Discord, X and a marketplace, and how do we get the first Clubs and Holders. Anything marked **to fill** needs a real number from a real conversation; nothing here counts as traction until it is filled.

## Who it is for

The first users are the people around a verified Monad NFT collection ([ADR 0025](adr/0025-clubs-are-for-nft-collections.md)), in three roles that want different things:

| Role | What they have today | What they want |
|---|---|---|
| **Club Owner** (the project's founder or lead) | A Discord and an X account they pay for in time. The marketplace takes the trading fees. | Holders who stay and talk, a way to fund community work, and trading that doesn't leave the community. |
| **Holder** | A bag, a Discord role, and nothing for the activity they bring. | Something back for holding and talking, and a way to swap without a stranger sending first. |
| **Trader** | Floor listings and DMs. | A swap NFT-for-NFT (or NFT plus MON) with no one to trust. |

The demo mirrors three real collections: Chog Genesis (1,969 supply), skrumpeys (3,333) and r3tards (1,033) ([12 · Demo](12-demo.md)). They are the first targets because they are the ones we already know.

## Why they would move

The honest answer is that they don't move. Discord stays the place people chat, X stays the place projects announce, and a marketplace stays the place floors are bought. A Club is a layer on top of them that the existing tools can't offer, because each of the following goes against how they earn:

1. **The fees come back to the people who made the market.** Every completed swap pays a fee on each side. 50% goes to the Club's Holders, 25% to the Club fund the Owner collects and 25% to the protocol ([ADR 0022](adr/0022-club-rewards.md)). A marketplace keeps its fee and gives nothing back to the collection.
2. **Rewards follow what the community values, not noise.** Active Holders share the Holder pool, split by the NFTs they held on average over the week, and each Club's Owner decides who is paid within protocol bounds: every active Holder, only the most active, or a slice for members without NFTs too ([ADR 0040](adr/0040-points-floor-held-average-public-backing.md), [ADR 0044](adr/0044-owner-reward-settings.md)). Most points come from others backing their posts and replies: a weekly voice weighted by NFTs held, plus a small capped voice any verified account can spend across Clubs ([ADR 0038](adr/0038-points-from-backing.md), [ADR 0039](adr/0039-base-voice-for-verified-accounts.md)). Outside voices are capped per member, mutual backing counts half, and swaps add at most 14 points with a repeat counterparty halved ([ADR 0034](adr/0034-swaps-count-in-the-holder-bonus.md)), so an account farm earns about what its NFTs would, and who backed whom is published each epoch so anyone can check. Sponsors can add to a Club's pool for an epoch ([ADR 0035](adr/0035-sponsored-epochs.md)).
3. **The Owner is paid without a token launch.** The Owner claims the Club by proving they are the contract's `owner()`, then collects the Club fund. They don't have to sell anything or run a sale to fund the community.
4. **Posts and follows belong to the member.** They are signed by the member's wallet and exported in full ([ADR 0023](adr/0023-signed-posts-and-lenses.md)). A Discord server can be deleted or banned; a signed post can't be taken from its author.
5. **The swap needs no trust.** Escrow or signed swaps settle atomically, so "you send first" disappears.

Each of these gives someone a reason to try it once. None of them is enough alone, which is why the plan below starts with one Owner and one trade, not with a migration.

### What the money looks like

The numbers below are an illustration, not a forecast. They assume the mainnet fee of about $5 a side ([ADR 0018](adr/0018-adjustable-protocol-fee.md)).

| Swaps in a week | Fees paid | Holder pool (50%) | Club fund (25%) |
|---|---|---|---|
| 10 | $100 | $50 | $25 |
| 100 | $1,000 | $500 | $250 |
| 500 | $5,000 | $2,500 | $1,250 |

At 10 swaps a week the reward is small. We say so rather than hide it: a Club that trades 10 times a week is a social space with a small bonus, and one that trades 100 times is one where the top Holders get paid for turning up. The pitch to an Owner is the second Club, and the plan is to reach it by volume from the community, not by incentives from us.

## The growth loop

```text
Holder posts about their Club on X  ─►  post is shown as a card on the Club's Board
        ▲                                         │
        │                                         ▼
 Holder earns a bigger share        Visitor sees a Club with real trades
        ▲                                         │
        │                                         ▼
 Swap fees fund the pool  ◄──────  Visitor joins, holds, swaps or posts
```

What is already built and feeds the loop:

- **Share a deal on X** with a server-drawn preview card ([ADR 0031](adr/0031-share-a-deal-on-x.md)).
- **Share the week:** each Club's weekly recap with the fees and the top Holders' payouts, as an X post.
- **Holders' own X posts** count toward the Holder bonus, and appear on the Club's Board as cards ([ADR 0024](adr/0024-x-posts-and-the-holder-bonus.md)).
- **Live standings and nudges:** a Holder sees their rank, the epoch closing and a prompt to post, through the bell inbox ([ADR 0030](adr/0030-likes-club-inbox-and-recap.md)).

Every Holder who is rewarded for posting is also marketing the Club, in the one place the community already is.

## Acquisition plan

We go **Owner first**. One Owner brings their Holders; one Holder brings nobody reliably.

### Phase 0 · Hackathon week (now to submission)

Goal: real people on the testnet app, not only personas.

- [ ] Run the two-wallet testnet pass and one full rewards epoch, so the demo shows a real claim ([06 · Roadmap](06-roadmap.md)).
- [ ] Recruit **5 to 10 testers** from communities we belong to (Monad Discords, NFT holders we know), each with a wallet and a shared profile. Target: 10 swaps and 20 signed posts from people who aren't us.
- [ ] Ask **one Owner** (Chog Genesis first, since the demo is built on it) to look at their Club and claim it. Record their reaction and their objections in the table at the end of this page.
- [ ] Put the testers in a small Discord or Telegram group, so there is a community to point at, even a small one.

### Phase 1 · First 30 days after

Goal: 3 Clubs with a claimed Owner, each with at least 10 active members.

1. **Pitch Owners with their own Club already built.** The Club exists the moment a collection is verified, so the message is "your Club is live, here is your page and what is waiting in your fund", not "sign up".
2. **Seed volume honestly.** Ask Owners to run one swap event, such as a Holders' trade day with a floor-for-floor pairing. Don't pay people to trade: wash trading is excluded from rewards on purpose, and a fake number would fail the first time a judge or an Owner checks the chain.
3. **Publish the weekly recap** for every Club on X, with its fees and its top Holders, every week without a gap. It is the one post that shows the stake is real.
4. **Pick one metric per Club** and report it: swaps per week, Holders who posted, rewards claimed.

### Phase 2 · Day 30 to 90

Goal: a Club where the Holder pool is large enough that holding and posting is worth a Holder's attention.

- Mainnet launch for the Clubs that are ready, after the go/no-go list in [11 · Test plan](11-test-plan.md).
- Add Clubs for collections that ask, through the verified-collections list ([ADR 0014](adr/0014-verified-collections-list.md)), in the order Owners request them.
- Use what the first Owners tell us to choose among the ideas not built yet: Owner bounties from the Club fund, badges and a member of the week.

## How we will know it works

| Signal | Why it matters | Now | 30 days |
|---|---|---|---|
| Clubs with a claimed Owner | An Owner means a community that chose to be here | 0 real | 3 |
| Active members per Club (a signed post or swap in the week) | Participation, not sign-ups | to fill | 10 |
| Swaps per Club per week | Where the money comes from | demo only | 10 |
| Holders who claimed rewards | The stake reaches people | to fill | 20 |
| Holders who posted on X about their Club | The growth loop is turning | to fill | 15 |

## Risks we know about

- **Volume is the whole model.** With few swaps the pool is near empty. The plan relies on Owners bringing trade, and we should be ready to hear that they won't.
- **Cold start.** A Club with no posts looks dead. The demo world solves this for the demo only; real Clubs need the Phase 0 testers.
- **We are building on one chain and a few collections.** If Monad's NFT activity stays small, so does the pool. The Clubs are a bet on the community, not on a number.
- **Gaming.** Top 10 by holdings, posts-only bonus and no payment for trading are our defences. The hold-time snapshot is not built, so a Holder can buy shortly before an epoch closes ([ADR 0029](adr/0029-top-holders-and-posts-only-bonus.md)). We should fix this before mainnet.

## Conversations so far

Fill this in as they happen; judges and Owners care more about three honest rows than about a long plan.

| Date | Who (role, collection) | What they said | What we changed |
|---|---|---|---|
| to fill | | | |
