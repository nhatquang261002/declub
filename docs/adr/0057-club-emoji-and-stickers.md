# ADR 0057: A Club's own emoji and stickers

**Status:** Accepted · 2026-10-12 · Web only: no contract. Builds on [ADR 0056](0056-post-pictures-and-emoji.md) (the private picture store) and [ADR 0016](0016-clubs-and-momentum.md) (Club staff). The spec is [09 · Clubs](../09-clubs.md#club-emoji-and-stickers); the threats are in [04 · Security](../04-security.md#club-emoji-and-stickers).

## Context

A Club is a community with its own jokes and art, and the fixed emoji list has none of it. Members asked for Club emoji (small, in a line of text) and stickers (large, on their own). Posts are signed records ([ADR 0023](0023-signed-posts-and-lenses.md), [0056](0056-post-pictures-and-emoji.md)), so whatever lets a post use one must not make a signature depend on a picture the Club can later change.

## Decision

**A Club's staff keep a small set of named pictures, with twelve stickers built in for every Club; members use them by typing `:name:`.**

- **Shortcodes in plain text.** A post or reply says `:chog_wave:`. The text is signed as typed, so there is no new signed type and no change to ids or exports. The shortcode turns into the picture only when it is shown (`web/components/PostText.tsx`); a name the Club doesn't have, or has removed, stays as text. The picker in the composer and the reply box lists the Club's own first and inserts the shortcode.
- **Emoji and stickers differ in how they are drawn.** An emoji is a line of text high; a sticker is large wherever it appears. A post that is only one shortcode shows it larger still, so a sticker works as a reaction on its own. Both count as their characters toward the 280.
- **Names.** 2 to 24 lowercase letters, digits or `_`, with at least one letter (so a time like `10:30:45` is never one). One name is one thing in a Club: an emoji and a sticker can't share it. Adding a name that exists replaces its picture.
- **Who manages them: the Owner, Moderators and app admins,** on the Manage tab (`PUT` and `DELETE /api/clubs/[token]/pack`). Members use them. Adding refuses an archived Club; removing doesn't. Every add, replace and removal is in the Moderation log.
- **Limits: 50 emoji and 20 stickers per Club, 256 KB each.** The browser shrinks to 128 px (emoji) or 512 px (stickers) as WebP, or JPEG where the browser can't. The server accepts PNG, JPEG or WebP whose bytes match (never SVG or GIF) and holds them to 256 KB, so a Club's pack is at most about 18 MB, and in practice well under 3 MB.
- **Kept with the post pictures.** The list is one row per Club (`declub:club-pack:<chainId>:<club>`: name, kind, type, size, SHA-256, time, who added it). Each picture is a private object at `club-pack/<chainId>/<club>/<name>-<hash12>`. The hash is in the object's key and in the address a reader fetches (`?v=`), so replacing a picture never shows the old one from a cache, and the old object is deleted. The app serves them (`GET .../pack/[name]`, public, `nosniff`, a `sandbox` content-security-policy, cached five minutes); the store has no public address. Purging a Club deletes them.
- **Twelve stickers every Club has.** `gm`, `gn`, `lfg`, `wagmi`, `wen`, `hodl`, `gg`, `wtb`, `wts`, `deal`, `gem` and `swap` are built in, so a new Club has stickers before its staff add any, and the sticker list is never empty. They are static SVG files in `web/public/stickers`, drawn by `brand/build/stickers.py` from shapes and outlined text in the brand's colours (no third party's art, no font to load). They are our own files, not an upload, so SVG is safe here: a test checks each is only shapes (no script, handler, link or image). A Club that adds an emoji or sticker of the same name replaces the built-in one for itself. `GET .../pack` lists them as `builtin`, so another app can draw them.
- **Public, and not signed.** Anyone can read a Club's pack (`GET .../pack`), which is what another app needs to draw its posts' shortcodes. Readers see name, kind and address, not who added it. The pack is Club configuration like the Club page, not a record a member signs, so it isn't in the signed feed.

## What it does not do

- **Old posts change with the pack.** Removing or replacing a picture changes how every post that names it reads. The signed text does not change. That is the point of keeping shortcodes as text, and it is how staff take a bad picture down at once (apart from a copy cached for up to five minutes).
- **No scanning, and no member submissions.** Nothing looks at a picture, and only staff add. A Club that wants member art asks the Owner to add it.
- **No moving pictures.** A GIF becomes its first frame in the browser, and the server takes none. The built-in stickers are still.
- **Not carried by the store dump.** [ADR 0055](0055-full-store-dump.md) restores each row's name, kind and hash; the pictures need Blob's own backup.
- **A Club's pack is not portable** to another Club.

## Alternatives

- **A sticker as a post's picture, signed by id.** Cleaner for "send a sticker" but needs a new signed type and ties a signature to something staff can remove. Shortcodes give the same result with no signing change.
- **Any Holder can submit, staff approve.** More lively, but it needs a queue and more moderation. It can be added on top of this.
- **Unicode private-use codepoints or a custom font.** Clever, but not portable and not accessible.
- **Public Blob addresses.** A removed picture would stay reachable to anyone with the address.
