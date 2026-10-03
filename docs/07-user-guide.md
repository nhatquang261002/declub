# 07 · User Guide

On Deal is a peer-to-peer, non-custodial way to swap digital assets on Monad: NFTs (ERC-721), tokens (ERC-20) and MON. Nobody holds anything for you. Either the contract settles both sides in one transaction, or nothing moves.

The in-app version of this guide has two bases, side by side: **Deals** at `/guide` ([page](../web/app/guide/page.tsx)) and **Clubs** at `/guide/clubs` ([page](../web/app/guide/clubs/page.tsx)).

## Sign in

- **Sign in** (top right) opens Privy. You can use Google, X, Discord or a wallet; the wallet option is listed first. If you sign in with a social account and this browser has no wallet for it, the button turns into **Connect wallet** or **Link a wallet**.
- On a deployment without Privy, the button says **Connect wallet** and lists the wallets installed in your browser.
- On the wrong network the button turns into **Switch to Monad Testnet**.
- You need test MON for gas, and for any MON you put in a deal.

## Make a deal

Press **Create deal**. The form has three steps: **Deal type**, **Your assets**, **Confirm**.

1. **Deal type.** If signed swaps are on, you first choose how the deal settles (see [Locked deals or signed swaps](#locked-deals-or-signed-swaps)). Then you choose one of three kinds:
   - **Open offer:** post what you give, with an optional note of up to 280 characters, and let people send you offers. You pick the one you like.
   - **Request exact assets:** name what you want back. Whoever holds it can accept in one transaction.
   - **Request by trait:** ask for NFTs with a trait, like "any 2 Chogs with a Crown hat". Paste a collection's address (or tap **Chog**), pick up to five trait values, choose *any of* or *all of*, and set how many. You can add several trait requests, and exact assets beside them.
2. **Your assets.** Add what you give with **+ MON**, **+ Token** or **+ NFT**. The NFT picker shows what your wallet holds, or you can paste a collection address and an id. Then decide who can take it (anyone, or **Only this wallet can accept**) and when it expires: 1 hour, 24 hours (the default), 7 days or Never. A side holds up to 10 assets.
3. **Confirm.** Check the summary, then approve and create:
   - **Approve** each asset you offer, one at a time ("1 of 3"). An NFT collection is approved once for all its NFTs. A token is approved for the exact amount in this deal.
   - **Create deal** (or **Post open offer**) locks your side in the contract. The MON you send includes the protocol fee, which is held with your deal.

You then land on the deal's page, which you can share.

## A deal for one person

To lock a deal to the person you agreed it with, put their wallet in **Only this wallet can accept**. If they have shared their profile (Account page), you can type their X or Discord handle instead, like `@bob`, and press **Find**. You'll see the wallets they show under that handle; pick the one they'll accept from. The review shows the handle next to the address.

Only people who turned on "Show my profile to other traders" can be found, and you need to be signed in. A handle tells you the X or Discord account and the wallet belong to the same person, not that they're honest, and lookalike handles exist: check the handle and the address against your conversation.

## Take a deal

Open any deal from **Deals**. The page shows **You get** and **You give**, the maker's full wallet address, and a **Your move** panel with the next step.

- **Exact assets:** approve what you send if asked, then **Accept & swap**. You pay the requested MON plus your share of the fee in the same transaction. Both sides move together, or the transaction fails and nothing moves.
- **By trait:** first choose which of your NFTs you'll send. Each request is checked against your pick ("Checked" or "doesn't match") before you can accept.
- **Open offer:** you can't accept it directly. Build an offer from your own assets and press **Send offer**. Your offer is held in the contract until the maker accepts or rejects it, or you press **Withdraw my offer**, which works at any time, even after the deal has closed.
- **For someone else:** a deal made for one wallet shows "This offer is for someone else" to everyone else.

If a payout to you was refused, for example by a token or a contract wallet, the deal page shows **Waiting for you to collect**. It's held safely for you; press **Claim** to collect it.

## Your own deals

- **Cancel deal** returns everything you locked, fee included, while the deal is still open and hasn't expired.
- After it expires, press **Reclaim my assets**. Anyone may press **Return assets to maker**, which always sends them back to you.
- On an open offer you see every offer you've received. **Accept & swap** completes the deal with that offer; **Reject** returns it to its sender.

## Locked deals or signed swaps

When signed swaps are on, step 1 of Create asks how the deal settles. Both kinds appear in the same list, tagged **Locked** or **Signed**.

| | Lock assets now | Sign only |
|---|---|---|
| Can it fail? | No. Once someone accepts, both sides move together | Yes, if you move the asset or revoke the approval before a match |
| Cost | Gas to create, and again to cancel; approvals too | Free to post and remove; approvals only |
| Your assets | Held by the contract | Stay in your wallet |
| Can use | MON, NFTs, tokens, trait requests, open offers | NFTs and tokens (MON as WMON); no traits |
| Who can take it | Anyone, one named wallet, or one of the offers you get | Anyone that meets your terms; a matcher finds pairs and rings of up to 4 |
| Ends | Accepted, cancelled, or expired and reclaimed | Settled, removed from the pool, or its deadline passes (10 minutes to 7 days) |

**Lock** when the other side must be certain it will go through: a specific buyer, a high-value trade, anything with MON or a trait. **Sign** for quick NFT and token swaps where you'd rather not lock anything.

**Signed swaps.** You choose what you give and the least you'll accept, and a deadline (10 minutes, 1 hour, 6 hours, 24 hours or 7 days). The steps approve your assets, wrap the MON you need for the fee into WMON, then **Sign and post**. On the swap's page:

- **Remove from pool** is free, but a copy of your signature that already left the pool could still be used until the deadline.
- **Cancel on-chain** costs gas and makes the signature useless for good.
- **Paused** means your wallet can't honour the swap right now (the asset moved, or an approval was revoked). Fix it and the swap comes back.

## Fees

- Every completed deal charges a small flat protocol fee per side, so both people pay the same. Nobody pays it if a deal is cancelled, expires, or an offer is rejected or withdrawn. The screens show the exact amount before you confirm.
- **Locked deals** take it in MON with your side, hold it, and refund it if the deal doesn't complete. A deal keeps the fee it was listed with, for both sides.
- **Signed swaps** take it in WMON from your wallet when the swap settles. You sign the most you'll pay; if the fee is cut before then, you pay less.
- The fee can be lowered at any time, or raised with a week's notice, and the screens say when a raise is coming. It can never go above a ceiling set when the contract was deployed ([ADR 0015](adr/0015-protocol-fee.md), [ADR 0018](adr/0018-adjustable-protocol-fee.md)).
- You also pay Monad's network gas.

## Finding deals and keeping track

- **Deals** lists everything open. Tabs: **Open**, **For you** (deals made for your wallet) and **All**. Search by NFT id, token symbol or address, or the maker's wallet; filter by MON or by type (**Locked** or **Signed**); sort by **Newest first** or **Ending soon**. Type a page number to jump to it.
- **History** shows the deals your wallet made, took or filled, signed swaps included, with counts of active, completed and expired deals.
- **The bell** tells you about a deal made for you, a deal of yours that was accepted, is about to expire or has expired, and a signed swap that settled, paused or was dropped. When signed in, what you've read syncs across devices. You can also turn on browser alerts.

## Account

The **Account** page (signed in with Privy) lets you:

- link or unlink email, Google, X and Discord;
- link several wallets and choose the one you trade with (**Use this wallet**);
- turn on **Show my profile to other traders**, which shows your X or Discord handle beside your wallet on your deals and lets people find you by handle;
- export the key of an embedded wallet, if the deployment creates them.

## Clubs and Momentum

A **Club** is the community for one verified NFT collection or memecoin, such as Chog. A memecoin can share its collection's Club. Open **Clubs** in the header to see them all, busiest first. Each Club has four tabs:

- **Market:** the open deals and signed swaps that offer or ask for the asset (**For trade**, **Wanted**), and **Recent swaps**.
- **Board:** short posts from members.
- **Members:** a leaderboard of the people in the Club.
- **Manage:** only for the Club's staff (see *Roles*).

**Joining.** Sign in, link a wallet, and press **Join**. Anyone signed in can join. **Joining shows your wallet on the Members list**, so join with an account whose wallet you are happy to show. **Leave** takes you off the list again.

**Holder badge.** A member gets a *Holder* badge when their linked wallets hold the asset (any NFT of the collection, or the minimum amount of a token; in a shared Club, either one). It is what they held **at the last check**, which the app repeats about once a day. It is not a guarantee that they hold it now, and the badge gives no extra powers, except when a Club's Owner limits posting to Holders.

**Momentum.** A score for how busy an asset's market has been over the last 30 days, newest activity counting most (it halves every week). Completed swaps count the most; new deals count a little, and at most three a day per wallet. Posts count for nothing. A Club's Momentum ranks Clubs on `/clubs`, with an arrow for the change since last week. A member's Momentum ranks them inside their Club. It says "this market has been busy", not that the asset is good or safe, or that a member is honest. Only activity the app has recorded counts; with the fill watcher running, that includes swaps made outside the app.

**Posting.** You need to be a member and to have shared a verified X or Discord profile (Account page). A post is plain text of up to 280 characters, with no formatting, and links in it are not clickable. A *Looking for* post can also link one of the Club's own deals or signed swaps. You can post once every 30 seconds and five times an hour in each Club, and delete your own posts.

**Reporting.** Report a post that is spam or abuse (once per post, and not your own). When three different Holders (or staff) have reported a post it is hidden for everyone but its author and the staff, until a moderator restores or deletes it. Every report reaches the staff, and posts by the Owner or a Moderator are never hidden by reports.

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
- Review every asset, token id, amount, the wallet that can accept, and the expiry.
- Public deals can be taken by anyone who holds the requested assets; a deal for one wallet can only be taken by that wallet.
- Read the fee line before you confirm. It is only charged when the deal completes.
- This is a Monad testnet demo with test assets. Do not use valuable mainnet assets.
- Never approve or send assets to a contract address copied from an untrusted message.
- An open offer's note, a Club post or a profile link is written by a person, not checked by On Deal. A handle, a Holder badge or a high Momentum is not an endorsement. Check the deal itself before you sign.

## For maintainers

- The Guide page's comparison and the create screen's six settlement chips (*Can't fail*, *Costs gas*, *Assets locked*, *Free*, *Nothing locked*, *Can fail*) read the same words from `web/lib/settlementTerms.ts`. Each chip's tooltip links to its entry on the Guide (`/guide#cant-fail`, `#costs-gas`, `#assets-locked`, `#free`, `#nothing-locked`, `#can-fail`), so change a reason there and both follow.
- The settlement section only appears when signed swaps are configured (`NEXT_PUBLIC_ON_DEAL_INTENTS_ADDRESS`). The reasoning behind the two paths is in [ADR 0008](adr/0008-trade-intents.md) and [ADR 0009](adr/0009-ring-swaps.md).
