# 07 · User Guide

DeClub gives every verified Monad NFT collection a Club, with its memecoin if it has one: a place to trade it, talk about it and share in the fees its market pays. Trading is peer-to-peer and non-custodial: NFTs (ERC-721), tokens (ERC-20) and MON. Nobody holds anything for you. Either the contract settles both sides in one transaction, or nothing moves.

The in-app version of this guide has two bases, side by side: **Deals** at `/guide` ([page](../web/app/guide/page.tsx)) and **Clubs** at `/guide/clubs` ([page](../web/app/guide/clubs/page.tsx)).

## Sign in

- **Sign in** (top right) opens Privy. You can use Google, X, Discord or a wallet; the wallet option is listed first. If you sign in with a social account and this browser has no wallet for it, the button turns into **Connect wallet** or **Link a wallet**.
- On a deployment without Privy, the button says **Connect wallet** and lists the wallets installed in your browser.
- On the wrong network the button turns into **Switch to Monad Testnet** (**Switch to Monad** on mainnet).
- You need test MON for gas, and for any MON you put in a deal.

## Make a deal

Press **Create deal**. The form has three steps: **Deal type**, **Your assets**, **Confirm**.

1. **Deal type.** If signed swaps are on, you first choose how the deal settles (see [Locked deals or signed swaps](#locked-deals-or-signed-swaps)). Then you choose one of three kinds:
   - **Open offer:** post what you give, with an optional note of up to 280 bytes (plain text, so about 280 characters), and let people send you offers. You pick the one you like.
   - **Request exact assets:** name what you want back. Whoever holds it can accept in one transaction.
   - **Request by trait:** ask for NFTs with a trait, like "any 2 Chogs with a Crown hat". Paste a collection's address (or tap **Chog**), pick up to five trait values, choose *any of* or *all of*, and set how many. You can add several trait requests, and exact assets beside them.
2. **Your assets.** Add what you give with **+ MON**, **+ Token** or **+ NFT**. The NFT picker shows what your wallet holds, or you can paste a collection address and an id. Then decide who can take it (anyone, or **Only this wallet can accept**) and when it expires: 1 hour, 24 hours (the default), 7 days or Never. A side holds up to 10 assets, and at most 5 of them NFTs.
3. **Confirm.** Check the summary, then approve and create:
   - **Approve** each asset you offer, one at a time ("1 of 3"). An NFT collection is approved once for all its NFTs. A token is approved for the exact amount in this deal.
   - **Create deal** (or **Post open offer**) locks your side in the contract. The MON you send includes the protocol fee, which is held with your deal.

You then land on the deal's page, which you can share.

## A deal for one person

To lock a deal to the person you agreed it with, put their wallet in **Only this wallet can accept**. If they have shown their handle (Profile page), you can type their X or Discord handle instead, like `@bob`, and press **Find**. You'll see the wallets they show under that handle; pick the one they'll accept from. The review shows the handle next to the address.

Only people who turned on "Show my X or Discord handle" can be found, and you need to be signed in. A handle tells you the X or Discord account and the wallet belong to the same person, not that they're honest, and lookalike handles exist: check the handle and the address against your conversation.

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

Each NFT can be in only one of your open signed swaps at a time, and your open swaps together can't give more of a token than your wallet holds. The pool takes up to 20 open swaps per wallet. Remove a swap from the pool to free what it gives.

## Fees

- Every completed deal charges a small protocol fee for each NFT a side gives (one if it gives none), so a bundle of NFTs pays what the same NFTs pay one by one. Nobody pays it if a deal is cancelled, expires, or an offer is rejected or withdrawn. The screens show the exact amount before you confirm.
- **Locked deals** take it in MON with your side, hold it, and refund it if the deal doesn't complete. A deal keeps the fee it was listed with, for both sides.
- **Signed swaps** take it in WMON from your wallet when the swap settles, for each NFT you give. You sign the most you'll pay per NFT; if the fee is cut before then, you pay less.
- The fee can be lowered at any time, or raised with a week's notice, and the screens say when a raise is coming. It can never go above a ceiling set when the contract was deployed ([ADR 0015](adr/0015-protocol-fee.md), [ADR 0018](adr/0018-adjustable-protocol-fee.md)).
- **Where it goes:** each week, 50% of the fees a Club's swaps paid goes back to that Club's Holders who earned enough points that week and 25% to its Club fund ([Clubs, Rewards](#rewards)); the rest stays with the protocol.
- You also pay Monad's network gas.

## Finding deals and keeping track

- **Deals** lists everything open. Tabs: **Open**, **For you** (deals made for your wallet) and **All**. Search by NFT id, token symbol or address, or the maker's wallet; filter by MON or by type (**Locked** or **Signed**); sort by **Newest first** or **Ending soon**. Type a page number to jump to it.
- **History** shows the deals your wallet made, took or filled, signed swaps included, with counts of active, completed and expired deals.
- **The bell** tells you about a deal made for you, a deal of yours that was accepted, is about to expire or has expired, and a signed swap that settled, paused or was dropped. When signed in it also carries Club news: replies and likes on your posts, your pins, X posts that counted, rewards you earned, your rank in a running epoch and a nudge when an epoch is about to close. What you've read syncs across devices. You can also turn on browser alerts.
- **Share on X.** On a live deal, or one that went through, press **Share on X** (or **Share the swap on X**). The app first shows a preview of the card; the button there opens X with the text and the deal's link.

## Profile

Every wallet has a public page at `/profile/<address>`. Click a wallet's name or avatar anywhere (a post, a Club's members, a standings row, a deal) to open it. It shows the wallet's avatar, name and bio, its verified X or Discord handle if the owner shows one, its full address, how many follow it, the Clubs it is in (the one its Members list shows), the posts it wrote on Club Boards (as cards you can like and reply to if you belong to that Club) and whom it follows. Press **Follow** there to follow it with a signature.

Your own page (**Your profile** in the wallet menu) has **Edit profile**, signed in with Privy, to:

- write a **display name** (up to 32 characters) and a **bio** (up to 160). They are plain text and unchecked, so they only appear on the profile page: deals and posts keep showing your verified handle and your address;
- set **Your avatar**: pick an NFT one of your linked wallets holds (**Pick from my NFTs**) or upload a picture. It shows on your wallet everywhere, on every wallet linked to your sign-in, and an NFT avatar disappears while your wallets no longer hold it;
- turn on **Show my X or Discord handle**, which shows your X or Discord handle beside your wallet on your deals and lets people find you by handle.

## Account settings

**Account settings** (in the wallet menu; signed in with Privy) lets you:

- link or unlink email, Google, X and Discord;
- link several wallets and choose the one you trade with (**Use this wallet**);
- claim your Club rewards;
- export the key of an embedded wallet, if the deployment creates them.

## Clubs and Momentum

A **Club** is the community for one verified NFT collection, such as Chog. A memecoin made for the collection shares its Club; a memecoin has no Club of its own. The Club's Owner decides whether holding the coin makes you a Holder, and from how much. Open **Clubs** in the header to see them all, busiest first. Each Club has these tabs:

- **Market:** the open deals and signed swaps that offer or ask for the asset (**For trade**, **Wanted**), and **Recent swaps**.
- **Board:** short posts from members, signed by their wallets, in the order you pick.
- **Challenges:** tasks the Owner sets the Club. Answer one with a post and, if you win, you earn points toward your share of the week's rewards (see below).
- **Members:** a leaderboard of the people in the Club. **Follow** the ones you trust.
- **Rewards:** what the Club's swaps paid in fees, what went to its Holders and its Owner, and your share to claim.
- **Manage:** only for the Club's staff (see *Roles*).

**Joining.** Sign in, link a wallet, and press **Join Club**. Anyone signed in can join. **Joining shows your wallet on the Members list**, so join with an account whose wallet you are happy to show. To leave, open the **⋯** menu next to it and choose **Leave this Club**.

**Holder badge.** A member gets a *Holder* badge when their linked wallets hold the asset (any NFT of the collection; in a Club with a memecoin, also the coin, if the Owner lets it count, from the minimum they set). It is what they held **at the last check**, which the app repeats about once a day. It is not a guarantee that they hold it now, and the badge gives no extra powers, except when a Club's Owner limits posting to Holders.

**Momentum.** A score for how busy an asset's market has been over the last 30 days, newest activity counting most (it halves every week). Completed swaps count the most; new deals count a little, and at most three a day per wallet; so does a Holder's own X post about the Club shared on its Board (see below), one a day. Other posts count for nothing. A Club's Momentum ranks Clubs on `/clubs`, with an arrow for the change since last week. A member's Momentum ranks them inside their Club. It says "this market has been busy", not that the asset is good or safe, or that a member is honest. Only activity the app has recorded counts; with the fill watcher running, that includes swaps made outside the app.

**Posting.** You need to be a member and to have linked an X or Discord account and turned on “Show my X or Discord handle” (Profile page; linking alone isn’t enough). A post is plain text of up to 280 characters, with no formatting, and links in it are not clickable. A *Looking for* post can also link one of the Club's own deals or signed swaps. A *Note* can share one X post, shown as a card. You can post once every 30 seconds and five times an hour in each Club, and delete your own posts.

**Sharing your X posts.** Any public X post can be shared as a card. Your **own** post (from the X account linked to your profile) counts for the Club, adding to your Momentum and your Holder bonus, when:

- you hold the Club's asset;
- you posted it on X in the last 48 hours;
- it is about the Club: it links the Club or its token, mentions, quotes or replies to the project's X account (shown as "@handle ✓" on the Club page), or uses one of the Club's tags (a tag alone counts half). The composer lists them.

One X post a day counts per Club, and each X post counts once. If yours didn't count, the app says why. If a moderator hides your Board post, it stops counting. For now every counted X post adds the same, however it does on X. Counting likes, reposts, quotes and replies (and dropping X posts you delete) is built, and switched on by the operator with `X_BEARER_TOKEN`.

**Your posts are signed.** When you press **Sign & post**, your Club wallet (the one the Members list shows for you) signs the post. It costs no gas and moves nothing. If another wallet is connected, the app asks you to switch first. Because each post is signed, it's your own record: anyone can check it, and each Club's posts are public with their signatures at `/api/clubs/<address>/feed`, yours across Clubs at `/api/wallets/<your wallet>/posts`.

**Choosing the order.** Above the Board, pick a lens: **Newest**; **Most active**, where posts from the members most active in the Club (trading, and their X posts about it) rise and older ones sink; **Holders**, only posts from members who hold it; or **Following**, only posts from wallets you follow (connect a wallet to see it). Pinned posts stay on top, except under Following.

**Challenges.** The Owner can set the Club a challenge at any time: a title, what to do, which week it ends with (a challenge always ends when an epoch does), and how many points each of the top one to three places earns. A challenge shows as a card on the Board, on the timeline and on the **Challenges** tab; open it to see its brief and everyone's entries. Write your entry there and press **Sign & enter**: it's posted on the Board too, and you can enter one post at a time (a new entry replaces the old one). Some challenges are for Holders only: you need the Holder badge to enter, but anyone can like. The Owner chose how winners are picked: **by likes**, from other members of the Club (you can't like your own entry, and likes lock when it ends), or **by the Owner**, who has 14 days after the end to pick. Winners earn the points as ordinary activity points for that week, so they raise your bonus and your place on the ramp; at most 20 challenge points count for you in a week, however many you win. The Owner can't enter their own challenge; Moderators can, but can't hide or ban someone in the same challenge while it runs. Every win is published with the week's points.

**Replies and likes.** Reply to a post once, one level deep (you can't reply to a reply), and like posts you value (not your own). Replies are signed with your Club wallet; likes aren't. Both count toward Club Rewards: they make your day active, and if you hold an NFT they give the author part of your weekly voice (see below). The author sees them in the bell.

**Following.** Press **Follow** beside a member's name, on a post or in the Members list. Your connected wallet signs the follow, which must be one of the wallets linked to your account. Press again to unfollow. Your follows are public at `/api/wallets/<your wallet>/follows`.

**Active days, streaks and live standings.** On the **Rewards** tab, **Live standings** shows where you stand in the running epoch: your rank among the Holders (by points), what you'd get if it closed now, and your **points** for the week: a total against the 35 that earn the full bonus, and how many came from posting (with the 7 active days), X shares and swaps. The bonus on your shares is shown as what those points turn into, in the last line. Each row shows a Holder's points, and the History view shows the points each Holder was paid for. A day is active when you have a visible top-level Board post that UTC day. Post on 3 or more days in an epoch, week after week, and a streak adds to your bonus (see *Rewards*). Standings refresh about every five minutes, and holdings are read when the epoch is built, shortly after it ends.

**Reporting.** Report a post that is spam or abuse (once per post, and not your own). Every report goes to the Club's staff, who see it in the **Reported** list on the **Manage** tab; a report alone hides nothing, because a hidden post's backing counts for nothing and a few accounts could otherwise strip a rival's points. A moderator hides it, deletes it or dismisses the reports.

### Rewards

Every completed swap pays a small protocol fee. Each week (an *epoch*), for every Club whose asset was traded:

- **50%** of those fees goes to the Club's **active Holders**: members whose linked wallets hold at least one NFT of the collection when the epoch is worked out and who earned points that week. By default every one of them is paid, a whole share from 5 points and part of it below (half at half the points). Each NFT is one share of the payout, summed over your linked wallets and **averaged over the week**: the NFTs you hold are read once a day and again when the epoch is built, so NFTs bought on the last day count for a fraction. Holding the Club's memecoin can make you a Holder, if the Owner allows it, but earns no share. Your share goes to your Club wallet.
  - **Active Holders earn more:** your shares count up to 25% more for your points that week. Most points come from **backing**: each Holder has a weekly voice of 10 points per NFT (counting up to 5) in their own Club, and every verified account (a shared X or Discord profile, shared for at least 7 days) has 3 more to spend on any Club's Board, shared over every Club it engages with. A voice is shared out over the posts and replies its owner likes (weight 1) or answers (2; the first reply on a post 4), and what your posts and replies receive is yours. Unused voice is lost at the end of the week, at most 10 of your points can come from the verified-account voices, and two people who back each other get half each way, and one person can give another at most 20 points a week. On top of that: 1 point for each UTC day you posted, replied or liked another member's post (up to 7 days), 3 points for each of your own X posts about the Club shared on its Board (one a day), and 2 for each completed swap with another wallet (half for a wallet you already swapped with that week, at most 14 an epoch). 35 points earn the full 25%. Being active on 3 or more days of an epoch, week after week, adds a streak bonus of up to 10% more. Counting X engagement (well-received posts earning up to 30 more points a week) is built but switched off until the operator sets `X_BEARER_TOKEN`; until then every counted post earns the same. A Holder with no points isn't paid for that epoch, however many NFTs they hold.
  - **Each Club's own rules:** those are the defaults. The Owner can pay only the most active Holders (a number, a percentage of Holders, or both), change the points for a whole share, and give members without NFTs a slice of the pool (up to 30%, split by their points). How points are counted is the same in every Club. Changes apply from the next week, and each week's rules are published with it. The Owner can also ban a member from rewards: they aren't paid, and their likes and replies give nobody points. Both are in the Club's log.
- **25%** goes to the **Club fund**, which the Club's Owner collects.
- The rest stays with the protocol.

Anyone can also sponsor an epoch from the Club's Rewards tab: enter an amount (at least 0.1 MON) and a name, send the MON, then sign to put your name on it. The MON is paid to the rewards operator, who funds the epoch with it, so it can't be refunded. It goes to the Club's Holders only, none to the protocol, and the Rewards tab says who gave what (with the wallet that paid). The weekly recap names only sponsors the operator recorded or the Owner paid as.

A swap that names two Clubs' assets splits its fee between them. If a Club has no Holder members yet, or no Owner, that part waits and is added to the next week's.

**Claiming.** After an epoch ends it is worked out and published, and claims open a day later (the default; a deployment can set another delay), so a mistake can be caught first. Then press **Claim** on a Club's **Rewards** tab or on your **Account** page: one claim collects every open week, in MON. Anyone can send a claim for you, but the MON always goes to your wallet. Unclaimed rewards can be collected for 90 days.

Every week's numbers, and the proof for every payout, are public at `/api/rewards/epochs/<n>`, and so is who backed whom (`/api/rewards/epochs/<n>/backing`, once the epoch is built), so anyone can recompute the points. That means likes are no longer private after an epoch closes. Rewards say a market has been busy, not that an asset is safe; and trading with yourself to earn them loses money, because each side pays the whole fee and only part of it comes back, shared with every Holder.

### Roles

| Role | Who | Can |
|---|---|---|
| **Owner** | The one wallet that the token contract names as its `owner()`, after it presses **Claim** on the Club page (that claims the Club; the Club fund is collected under **Rewards**). Or someone an app admin picked | Edit the description and up to three `https://` links, pin up to three posts, appoint up to ten moderators, hand the Club to another member, limit posting to Holders. Collects the Club fund each week |
| **Moderator** | Appointed by the Owner | Hide, restore and delete posts, ban and unban members of this Club (but not lift a ban the Owner made). Can't act on the Owner or other moderators |
| **Member** | Anyone who joined | Post, report, appear on the leaderboard |
| **Visitor** | Not signed in or not joined | Read only |

The app's admins can do all of this in every Club and ban someone from all of them. A banned person leaves the Club, loses any role and can't rejoin or post. Staff actions are written to a log that only staff can read.

A deal settles the same whether or not you're in a Club: nothing in a deal or its fee depends on one, and rewards are paid afterwards from a separate contract. Posts and memberships are kept by the app's server, and a Club only exists for assets on the verified list, so a copycat collection can't get one.

## Safety guidelines

- Confirm the wallet and network before signing.
- Review every asset, token id, amount, the wallet that can accept, and the expiry.
- Public deals can be taken by anyone who holds the requested assets; a deal for one wallet can only be taken by that wallet.
- Read the fee line before you confirm. It is only charged when the deal completes.
- This is a Monad testnet demo with test assets. Do not use valuable mainnet assets.
- Never approve or send assets to a contract address copied from an untrusted message.
- An open offer's note, a Club post or a profile link is written by a person, not checked by DeClub. A handle, a Holder badge or a high Momentum is not an endorsement. Check the deal itself before you sign.

## For maintainers

- The Guide page's comparison and the create screen's six settlement chips (*Can't fail*, *Costs gas*, *Assets locked*, *Free*, *Nothing locked*, *Can fail*) read the same words from `web/lib/settlementTerms.ts`. Each chip's tooltip links to its entry on the Guide (`/guide#cant-fail`, `#costs-gas`, `#assets-locked`, `#free`, `#nothing-locked`, `#can-fail`), so change a reason there and both follow.
- The settlement section only appears when signed swaps are configured (`NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS`). The reasoning behind the two paths is in [ADR 0008](adr/0008-trade-intents.md) and [ADR 0009](adr/0009-ring-swaps.md).
