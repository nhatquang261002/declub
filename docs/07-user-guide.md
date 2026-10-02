# 07 · User Guide

On Deal is a peer-to-peer, non-custodial marketplace for dealing Chogs on Monad.

## How to deal

1. **Connect** an injected wallet and switch to Monad testnet.
2. **Create** a deal from any Create button. Pick a type (open offer, exact assets, or a trait), say what you want, then choose what you give and when it expires. Review it and confirm.
3. **Approve** On Deal to transfer your offered Chogs. This is a collection-wide ERC-721 approval and normally only happens once.
4. **Create the deal.** Your offered NFTs and MON are locked in escrow in the same transaction.
5. **Accept a deal** when you own every requested Chog. The taker approves the collection if needed and sends requested MON in the Accept & Swap transaction.
6. **Settle, cancel, or reclaim.** A successful fill swaps both sides atomically. The maker can cancel an open deal, or reclaim it after expiry.

## A deal for one person

To lock a deal to the person you agreed it with, put their wallet in **Only this wallet can accept**. If they have shared their profile (Account page), you can type their X or Discord handle instead, like `@bob`, and press **Find**. You'll see the wallets they show under that handle; pick the one they'll accept from. The review shows the handle next to the address.

Only people who turned on "Show my profile to other traders" can be found, and you need to be signed in. A handle tells you the X or Discord account and the wallet belong to the same person, not that they're honest, and lookalike handles exist: check the handle and the address against your conversation.

## Locked deals or signed swaps

When signed swaps are enabled (`NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS`), step 1 of Create asks how the deal settles. Both end in the same list, tagged **Locked** or **Signed**.

| | Lock assets now | Sign only |
|---|---|---|
| Can it fail? | No. Once someone accepts, both sides move together | Yes, if you move the asset or revoke the approval before a match |
| Cost | Gas to create, and again to cancel; approvals too | Free to post and remove; approvals only |
| Your assets | Held by the contract | Stay in your wallet |
| Can use | MON, NFTs, tokens, trait requests | NFTs and tokens (MON as WMON); no traits |
| Who can take it | Anyone, one named wallet, or one of the offers you get | Anyone that meets your terms; a matcher finds pairs and rings of up to 4 |
| Ends | Accepted, cancelled, or expired and reclaimed | Settled, removed from the pool, or its deadline passes (10 minutes to 7 days) |

**Lock** when the other side must be certain it will go through: a specific buyer, a high-value trade, anything with MON or a trait. **Sign** for quick NFT and token swaps where you'd rather not lock anything.

The create screen shows six short reasons as chips (*Can't fail*, *Costs gas*, *Assets locked*, *Free*, *Nothing locked*, *Can fail*). Each has a tooltip and links to its own entry in the in-app Guide (`/guide#cant-fail`, `#costs-gas`, `#assets-locked`, `#free`, `#nothing-locked`, `#can-fail`). The wording for all of them lives in one file, `web/lib/settlementTerms.ts`, which the tooltips and the Guide page both read; change a reason there and both follow. The reasoning behind the two paths is in [ADR 0008](adr/0008-trade-intents.md) and [ADR 0009](adr/0009-ring-swaps.md).

## Clubs and Momentum

A **Club** is the community for one verified NFT collection or token, such as Chog. Open **Clubs** in the header to see them all, busiest first. Each Club has four tabs:

- **Market:** the open deals and signed swaps that offer or ask for the asset, and the latest completed swaps.
- **Board:** short posts from members.
- **Members:** a leaderboard of the people in the Club.
- **Manage:** only for the Club's staff (see *Roles*).

**Joining.** Sign in, link a wallet, and press **Join**. Anyone signed in can join. **Joining shows your wallet on the Members list**, so join with an account whose wallet you are happy to show. **Leave** takes you off the list again.

**Holder badge.** A member gets a *Holder* badge when their linked wallets hold the asset (any NFT of the collection, or the minimum amount of a token). It is what they held **at the last check**, which the app repeats about once a day. It is not a guarantee that they hold it now, and the badge gives no extra powers, except when a Club's Owner limits posting to Holders.

**Momentum.** A score for how busy an asset's market has been over the last 30 days, newest activity counting most (it halves every week). Completed swaps count the most; new deals count a little, and at most three a day per wallet. Posts count for nothing. A Club's Momentum ranks Clubs on `/clubs`, with an arrow for the change since last week. A member's Momentum ranks them inside their Club. It says "this market has been busy", not that the asset is good or safe, or that a member is honest. Only activity the app has seen counts, so a deal made outside the app may be missing.

**Posting.** You need to be a member and to have shared a verified X or Discord profile (Account page). A post is plain text of up to 280 characters, with no formatting, and links in it are not clickable. A *Looking for* post can also link one of the Club's own deals or signed swaps. You can post once every 30 seconds and five times an hour in each Club, and delete your own posts.

**Reporting.** Report a post that is spam or abuse (once per post, and not your own). When three different members have reported a post it is hidden for everyone but its author and the staff, until a moderator restores or deletes it.

### Roles

| Role | Who | Can |
|---|---|---|
| **Owner** | The one wallet that the token contract names as its `owner()`, after it presses **Claim** on the Club page. Or someone an app admin picked | Edit the description and up to three `https://` links, pin up to three posts, appoint up to ten moderators, hand the Club to another member, limit posting to Holders |
| **Moderator** | Appointed by the Owner | Hide, restore and delete posts, ban and unban members of this Club. Can't act on the Owner or other moderators |
| **Member** | Anyone who joined | Post, report, appear on the leaderboard |
| **Visitor** | Not signed in or not joined | Read only |

The app's admins can do all of this in every Club and ban someone from all of them. A banned person leaves the Club, loses any role and can't rejoin or post. Staff actions are written to a log that only staff can read.

Clubs are community pages, not part of the contracts: nothing in a deal, a fee or a settlement depends on one. Posts and memberships are kept by the app's server, and a Club only exists for assets on the verified list, so a copycat collection can't get one.

## Safety guidelines

- Confirm the wallet and network before signing.
- Review every token id, MON amount, taker address, and expiry.
- Public deals can be filled by anyone who owns the requested assets; direct deals can only be filled by the named wallet.
- Multi-asset and signed deals charge a flat protocol fee per side, only when the deal completes ([ADR 0015](adr/0015-protocol-fee.md)); the screens show the exact amount before you confirm. The fee can be lowered at any time, or raised with a week's notice, which the screens show ([ADR 0018](adr/0018-adjustable-protocol-fee.md)). A locked deal keeps the fee it was listed with, for both sides. A signed swap is signed with the most you'll pay, and you pay less if the fee is cut first. Single-collection deals on the original testnet contract have no fee. Wallets also charge network gas.
- The current deployment is a Monad testnet demo with MockChog. Do not use valuable mainnet assets.
- Never approve or send assets to a contract address copied from an untrusted message.
- A Club post or a profile link is written by a member, not checked by On Deal. A Holder badge or a high Momentum is not an endorsement. Check the deal itself before you sign.

The in-app [Field Guide](../web/app/guide/page.tsx) contains the user-facing FAQ and walkthrough.
