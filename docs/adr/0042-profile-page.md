# ADR 0042: A profile page for every wallet, and the account page becomes account settings

**Status:** Accepted, amended 2026-10-10 (a **Deals** view: the wallet's open deals, from `/api/deals?maker=`) · 2026-10-07 · Web only: no contract change. Builds on [ADR 0011](0011-verified-profiles.md) (the shared X or Discord handle), [ADR 0023](0023-signed-posts-and-lenses.md) (signed posts and follows) and [ADR 0028](0028-account-avatars.md) (avatars).

## Context

`/account` held two different things: what a user shows to others (their avatar and whether their X or Discord handle shows beside their wallet) and what they manage for themselves (linked accounts, wallets, Club rewards). A wallet's name appeared in lists, posts and deals, but clicking it led nowhere: a handle opened X in a new tab and an address copied itself. There was no place to see who a wallet was, which Clubs it was in or who it followed, and no place to say anything about yourself beyond a handle.

## Decision

**Every wallet has a public profile at `/profile/<address>`. Its owner edits it there. `/account` becomes `/settings`, "Account settings", and keeps only what is private to the user.**

### The profile page

- **What it shows:** the avatar, a display name and a short bio (new), the verified X or Discord handle if the owner shows one, the full address (copyable, with a link to the explorer), follower and following counts, and a Follow button. Below, four views: **Clubs** (the Clubs whose Members list shows this wallet, newest join first, drawn with the Clubs page's own `ClubCard`), **Deals** (the locked deals and signed swaps this wallet has open, drawn as the deals page draws them, six to a page; `/api/deals` takes a `maker` for it), **Posts** (the wallet's Board posts across Clubs, drawn with the timeline's own `TimelineCard` in a masonry that loads the next page as the end nears; a reader who belongs to a post's Club can like and reply there, as on the timeline) and **Following** (the wallets it follows, each leading to its own profile).
- **Whose it is:** a profile is read by wallet address, like the signed records of ADR 0023, so it can be opened by anyone, signed in or not. Its Clubs come from an index of memberships by the wallet the Members list shows (`declub:wallet-clubs:<chain>:<wallet>`, entries `token:userId`), kept by `joinClub`, `leaveClub` and `syncMemberships`; memberships made before it existed appear the next time their owner's membership is read. A user who has several linked wallets has the same profile on each, as with avatars. A wallet's page says "This is you" when it is one of the viewer's linked wallets or the connected one.
- **Editing:** on their own profile a signed-in user gets **Edit profile**, which opens, in place, the three things that make up a profile: *About you* (name and bio), *Your avatar* (moved here from `/account`, unchanged) and *Show my X or Discord handle* (moved here from `/account`, unchanged except for its name: it was "Show my profile to other traders", which would now read as the whole page). Each saves on its own. A viewer connected without signing in can see their page but is asked to sign in to change it.
- **`/profile`** sends a connected wallet to its own page, and asks to connect otherwise.

### Getting there

The names the app already draws are the way in. `Who` (the "you", handle or address shown for a wallet) now links to that wallet's profile, and so does the avatar beside a post author, a Club member, a standings row and a Rewards earner. The places that sit inside a link already (a deal card) keep the plain text: `plain` drops the link, as it already dropped the link to X. The handle's link to X moves onto the profile page, where it is labelled with who checked it. An address with no handle is now a link too, and its copy button is an icon of its own beside it, so the address can still be copied from every place it appears. The wallet menu in the header has **Your profile** and **Account settings**.

### Account settings

`/settings` is the old account page without the avatar and the handle toggle: Club rewards, linked accounts and wallets (link, unlink, switch the active one, export an embedded wallet's key). `/account` redirects to it. The page's copy and every message that sent people to "the Account page" now say Profile or Account settings, whichever holds the control they are about.

### The name and bio

- **Plain text, never checked.** Anyone can write any name, including someone else's. So no list, post, deal or "who can accept" box uses it: those keep showing the verified handle and the address (ADR 0011). It appears only on the profile page, which says on hover that a name is the owner's own choice, and the verified handle sits beside it under a "Verified X" label so the two are not confused. Impersonation by name is therefore possible on that one page and no trade or reward depends on it.
- **Limits and cleaning.** The name is at most 32 characters on one line; the bio at most 160, with line breaks kept (never more than a blank line). Characters in the control, zero-width and bidirectional-override ranges are removed, so a name cannot hide text or reverse how it reads. Lengths are counted in characters, not UTF-16 units. A blank name and bio remove what was saved. The server checks everything again; the form is a convenience.
- **Storage.** The same row (`declub:about:<wallet>`) is written for each of the user's linked wallets, with the user id, and `declub:about-user:<userId>` lists them, exactly as for avatars. The wallets come from Privy, never from the request. Unlinking a wallet removes it from that wallet (on the next read of `/api/about`, or when Privy's webhook arrives), and a wallet that moved to another user keeps that user's row.
- **No new moderation surface.** There is no image and no link in it, only text rendered as text. If abuse appears, removing a row by wallet is the whole tool.

### Routes

- `GET /api/wallets/[address]/profile` (public, 240 requests a minute per client, cached for 30 seconds): `{ enabled, profile, avatar, about }`. Only what the owner chose to show leaves the server: no user id, no linked accounts other than the shown handle. An owner's own page asks with `?fresh=1`, which is not cached, so what they just saved shows at once. Each part is read on its own, so one that fails leaves a plainer page rather than an error.
- `GET` / `PUT /api/about` (signed in, 30 and 20 a minute): the caller's own name and bio. `PUT` takes `{ name, bio }`, and answers 422 with what is wrong, 413 above 4,000 bytes, 400 for something that isn't JSON.
- `GET /api/wallets/[address]/clubs` (public, same limit and cache): `{ enabled, clubs: [{ token, holder, joinedAt }] }`, newest join first. A Club that has left the verified list is skipped. Only the Club, the Holder badge and the join time leave the server; a user id never does.
- `GET /api/wallets/[address]/board?limit=&before=` (public, 120 a minute): `{ enabled, posts, next }`, the wallet's Board posts in the timeline's shape and cursor (`listWalletPosts`, sharing the timeline's like and reply counts), so the cards are the timeline's. Hidden posts and replies are never listed, and a Club that has left the verified list is skipped. A reader who sends a token also gets which posts they liked, and then the answer is not cached. The query key starts with `timeline`, so a like or reply made on a card updates it like the timeline's own lists.
- The follows come from the route ADR 0023 already has, `/api/wallets/[address]/follows`. The signed export `/api/wallets/[address]/posts` is unchanged and is not what the page draws.

## What it does not do

- **It doesn't show hidden posts, replies or moderation.** Posts a moderator hid are not listed, replies stay under their post on the Board, and hide, pin and ban stay on the Board where the Club's tools are. Signed and unsigned posts are both listed, as on the Boards.
- **It doesn't tie a user's wallets together.** Only the wallet a Club's Members list shows is listed under that Club, so a profile says no more than the Members lists do. Another linked wallet of the same user shows no Clubs. (When someone changes which wallet is shown, for instance by showing their handle on a different one, the Club moves with it.)
- **It doesn't list followers**, only their number: the signed record is the follower's, and ADR 0023 exports it by follower.
- **It doesn't list a wallet's holdings, or its filled and cancelled deals.** Only open ones show, the same as the deals page's Open tab (so a private offer shows only to the wallet it names). Holdings fit this page later.
- **It doesn't let the name stand in for the handle** anywhere that decides who a trader is.
- **It doesn't make the profile private.** A wallet's profile is as public as its on-chain activity; someone who doesn't want a handle or name shown leaves them off, and the page then shows the address, its Clubs, its posts and its follows, all of which were already public by wallet. Leaving a Club removes it from the page.

## Consequences

- A small new record (name and bio, a few hundred bytes a wallet) and two routes. Nothing in the contracts, Club points or rewards reads it.
- The avatar and handle controls are now two clicks from the wallet menu instead of one, and one page further from "Linked accounts", which is where a user learns they must link X first. The handle section links back to Account settings for that.
- Anything that linked to `/account` is redirected (308), including bookmarks.
