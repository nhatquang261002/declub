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
3. **The Owner can fund the community without a token launch.** The Owner claims the Club by proving they are the contract's `owner()`. The Club fund collects its share of the fees, sponsors can back any week, and the Owner can run challenges with points, trophies or an NFT prize. They don't have to sell anything or run a sale.
4. **Posts and follows belong to the member.** They are signed by the member's wallet and exported in full ([ADR 0023](adr/0023-signed-posts-and-lenses.md)). A Discord server can be deleted or banned; a signed post can't be taken from its author.
5. **The swap needs no trust.** Escrow or signed swaps settle atomically, so "you send first" disappears.

Each of these gives someone a reason to try it once. None of them is enough alone, which is why the plan below starts with one Owner and one trade, not with a migration.

### Where a Club's rewards come from

Swap fees are one source, and the smallest at first. A Club with little trading still has three more, all built, and all of them are things an Owner already does with a community by hand:

| Source | Who pays | Where it goes | Built |
|---|---|---|---|
| **Swap fees** | Traders, about $5 a side ([ADR 0018](adr/0018-adjustable-protocol-fee.md)) | 50% Holder pool, 25% Club fund, 25% protocol | [ADR 0022](adr/0022-club-rewards.md) |
| **Sponsors** | A project, a partner, an ecosystem fund, or the Owner | All of it to the Holder pool for one epoch, with the sponsor's name on the Rewards tab and the weekly recap | [ADR 0035](adr/0035-sponsored-epochs.md), [0036](adr/0036-sponsor-from-the-app.md) |
| **Challenges** | The Owner | Points toward the Holder bonus, a trophy on the winner's profile, and optionally an NFT or token the Owner sends and the app checks on chain | [ADR 0045](adr/0045-club-challenges.md), [0049](adr/0049-more-ways-to-pick-challenge-winners.md), [0050](adr/0050-challenge-rewards-beyond-points.md) |
| **Owner top-up** | The Owner | Same as a sponsor, shown as "Name (Owner)" | [ADR 0035](adr/0035-sponsored-epochs.md) |

This changes the pitch. DeClub is not a fee-sharing scheme that needs volume before it pays anyone. It is a way to grow a community while rewarding it: the Owner sets a task, a sponsor backs the week, Holders post and earn, and the Club has a recap to show for it. A brand that wants to reach a collection's Holders has a place to put money and a public record of what it bought. Swap fees then add to this as trading grows.

For a rough size of the fee source, at about $5 a side:

| Swaps in a week | Fees paid | Holder pool (50%) | Club fund (25%) |
|---|---|---|---|
| 10 | $100 | $50 | $25 |
| 100 | $1,000 | $500 | $250 |
| 500 | $5,000 | $2,500 | $1,250 |

This is an illustration, not a forecast. At 10 swaps a week the fee pool is small, and we say so. One sponsor of a few hundred dollars for a week, or an Owner's challenge with an NFT prize, can matter more to that Club than its fees do. The pitch to an Owner is therefore not "wait for volume" but "run a sponsored challenge this week, and the trading follows the attention".

What stays honest about this:

- **Sponsors trust the operator.** A sponsor pays the operator, who records and funds it with the epoch. The payment is checked on chain, but the deposit is not a contract. An on-chain `sponsor(club)` is deferred in [06 · Roadmap](06-roadmap.md). Say this to the first sponsors.
- **Sponsored money goes to the Holder pool only.** It never reaches the Club fund or the protocol, and a Club with no Holders carries it to the next epoch.
- **Challenge points are capped for every member** and an Owner can't raise the cap ([ADR 0050](adr/0050-challenge-rewards-beyond-points.md)). An NFT or token prize is the Owner's own, and the app never holds it. It shows "Prize not sent" if the Owner doesn't pay, and blocks that Owner's next asset prize.
- **Sponsoring a quiet Club pays whoever is active in it.** The pool still needs a holding and activity, but a sponsor should pick Clubs with real members ([ADR 0035](adr/0035-sponsored-epochs.md)).

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

I am a solo builder, and the thing a solo builder is worst placed to do is sell. So the plan has three steps in a fixed order: prove with a few real Owners, use that proof to bring in angels and a first hire, then launch on mainnet with a team that can keep selling. We go **Owner first** throughout: one Owner brings their Holders; one Holder brings nobody reliably.

### Step 1 · Prove it with real Owners (solo)

Goal: 3 Owners who claim their Club and run it with their own Holders on testnet. This is the evidence everything after depends on, and it costs time, not money.

- [ ] Finish the two-wallet testnet pass and one full rewards epoch, so there is a real claim to show ([06 · Roadmap](06-roadmap.md)).
- [ ] Make a target list of 20 collections, scored on: reachable Owner, a community that already trades and talks, and an Owner who controls the contract's `owner()` so they can claim. Start with the three we mirror (Chog Genesis, skrumpeys, r3tards).
- [ ] Talk to the Owners, one by one. The pitch is "your Club is already live, here is your page and what is waiting in your fund", not "sign up". Log every conversation in the table at the end of this page, objections included.
- [ ] With each Owner who says yes, bring 5 to 10 of their Holders in, and run one event: a challenge, ideally with a sponsor on the week (a project, a partner, or the Owner's own top-up), and a swap day if the Owner wants one. Don't pay anyone to trade: wash trading is excluded from rewards on purpose, and a fake number fails the first time an Owner or investor checks the chain.
- [ ] Find one sponsor for one of the three Clubs, and record it in the Conversations table. A first sponsored epoch is worth more than a fee estimate, and it also tests the sponsor flow ([06 · Roadmap](06-roadmap.md)).
- [ ] Post the weekly recap for each Club on X, every week without a gap.

**Done when:** 3 claimed Clubs, each with at least 10 active members and at least one challenge run, one Club with a sponsored epoch, and a written reason from each Owner why they would run it on mainnet. If the Owners won't, we learn that here, before anyone's money is spent.

### Step 2 · Angels and the first hire

Goal: enough money to hire the person who sells, and to pay for the audit mainnet needs.

- [ ] Bring the Step 1 results, a live demo and the unit economics above to angels who know the Monad and NFT scene, and to ecosystem grants and programs (**to fill**: which are open, the round size and terms).
- [ ] Ask each angel for something beyond money: two Owner introductions, a hire referral, an audit-firm or lawyer contact.
- [ ] First hire: a **community and Owner lead**, because Owner conversations are the bottleneck and a full-time job. Second: an engineer for audit fixes and mainnet operations.
- [ ] Get a lawyer's view before mainnet and before taking investment: paying Holders from fees may raise questions in some places.

**Done when:** the audit and the first hire are funded. If they aren't, stay solo, focus on the one Club that works, and keep the costs near zero.

### Step 3 · Mainnet, then Clubs by demand

Goal: 5 Clubs live on mainnet, then more because Owners ask, not because we push.

- [ ] Pass the audit and the go/no-go list in [11 · Test plan](11-test-plan.md), then launch with the Step 1 Clubs first.
- [ ] Add Clubs through the verified-collections list ([ADR 0014](adr/0014-verified-collections-list.md)), in the order Owners request them.
- [ ] Report one metric per Club in public: swaps per week, active members, rewards claimed.
- [ ] Use what the first Owners tell us to choose among the ideas not built yet ([06 · Roadmap](06-roadmap.md)).

## How we will know it works

| Signal | Why it matters | Now | End of Step 1 |
|---|---|---|---|
| Clubs with a claimed Owner | An Owner means a community that chose to be here | 0 real | 3 |
| Active members per Club (a signed post or swap in the week) | Participation, not sign-ups | to fill | 10 |
| Swaps per Club per week | Where the fee money comes from | demo only | 10 |
| Challenges run per Club | The Owner is using the Club to move the community | 0 real | 1 |
| Sponsored epochs | Someone outside the Club pays for its attention | 0 real | 1 |
| Holders who claimed rewards | The stake reaches people | to fill | 20 |
| Holders who posted on X about their Club | The growth loop is turning | to fill | 15 |

## Risks we know about

- **Swap volume alone won't carry a Club.** With few swaps the fee pool is near empty, so the plan leans on Owners using sponsors and challenges to bring activity first. If Owners won't run challenges and no one will sponsor, the offer is weak, and Step 1 should show that early.
- **Sponsors are not yet trustless.** The first sponsors trust the operator to record and fund their payment. Until the on-chain deposit exists, keep the early sponsors few and known.
- **Cold start.** A Club with no posts looks dead. The demo world solves this for the demo only; real Clubs need the Holders each Owner brings in Step 1.
- **We are building on one chain and a few collections.** If Monad's NFT activity stays small, so does the pool. The Clubs are a bet on the community, not on a number.
- **Gaming.** Top 10 by holdings, posts-only bonus and no payment for trading are our defences. The hold-time snapshot is not built, so a Holder can buy shortly before an epoch closes ([ADR 0029](adr/0029-top-holders-and-posts-only-bonus.md)). We should fix this before mainnet.

## Conversations so far

Fill this in as they happen; judges and Owners care more about three honest rows than about a long plan.

| Date | Who (role, collection) | What they said | What we changed |
|---|---|---|---|
| to fill | | | |
