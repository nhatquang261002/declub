# ADR 0056: Pictures and emoji in Board posts

**Status:** Accepted · 2026-10-12 · Amended by [ADR 0057](0057-club-emoji-and-stickers.md) (a Club's own emoji and stickers).  Web only: no contract. Extends [ADR 0023](0023-signed-posts-and-lenses.md) and [ADR 0016](0016-clubs-and-momentum.md). The spec is [09 · Clubs](../09-clubs.md#board-and-moderation); the threats are in [04 · Security](../04-security.md#post-pictures).

## Context

A Board post was 280 characters of plain text. Members asked for pictures (art, a trade screenshot, a meme) and an easier way to add emoji. Pictures are different from everything else the store holds: one may weigh a megabyte, a Club keeps hundreds of posts, and Redis is the wrong place for that. A post is also a signed record ([ADR 0023](0023-signed-posts-and-lenses.md)), so a picture that sits beside the signature could be swapped by whoever holds the store.

## Decision

**A post may carry one picture, signed by its hash and kept in object storage; the composer gets an emoji list.**

- **The signature covers the picture.** A post with a picture is an EIP-712 `ImagePost { club, kind, text, link, image, at }`, where `image` is the SHA-256 of the picture's bytes (`bytes32`). It is a separate type, so a post without a picture keeps its type, id and signature. The id is the struct hash, as before. The export carries the hash in the message and the picture's address beside it, so anyone can fetch the picture and check it against the signed hash.
- **The browser shrinks it first.** The longer side is scaled down to 1600 px and the picture written as WebP (JPEG where the browser can't), lowering quality until it is under 1 MB. Redrawing drops location and camera data, and an animated picture becomes its first frame. The browser hashes the result and signs; the picture goes as a `data:` URL beside the message.
- **The server checks it again.** PNG, JPEG or WebP only, with the bytes matching the type (never SVG, which can carry script, and no GIF), at most 1 MB, and its SHA-256 must equal the signed `image`. A picture without a signed hash, or a signed hash without its picture, is refused. At most 10 pictures a day per member, on top of the post limits.
- **Object storage, private.** Vercel Blob, one object per post at `post-images/<chainId>/<club>/<postId>` (`BLOB_READ_WRITE_TOKEN`; a private store, a separate one for each flavor). The post row keeps `{ type, size, hash }`. Without a token, production refuses posts with a picture (`images_unavailable`) and text posts carry on; development keeps pictures in memory.
- **Served by the app, never from the store.** `GET /api/clubs/[token]/posts/[id]/image` checks the post first, so **hiding a post hides its picture**: for a hidden post only its author and staff get it (the browser sends the token and shows it from memory), and everyone else gets a 404. The response is sent with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`. A public copy is cached for five minutes at most.
- **A picture lives as long as its post.** Deleting a post, purging a Club and a post falling off the end of the Board's 500 each delete it.
- **Emoji are a list in the composer and the reply box** that inserts at the cursor. They were always allowed in the text: the limit counts characters, not UTF-16 units. The list holds single-code-point emoji, so each counts as one; the system picker can add others, which may count as several (a family or a flag is several code points).
- **Replies stay text and emoji.** A post needs text as before: a picture alone is not a post.

## What it does not do

- **No scanning.** Nothing looks at what a picture shows. Reports and moderators are the answer, as for text, and hiding is immediate. A cached public copy can outlive a hide by up to five minutes.
- **The store dump doesn't hold pictures** ([ADR 0055](0055-full-store-dump.md)). It restores each post's `{ type, size, hash }`; the bytes are in Blob and need Blob's own backup or the export's addresses. A picture lost from Blob leaves a post that says "couldn't be loaded", and the signed hash lets anyone check a copy that turns up.
- **A client can skip the shrinking,** so the server's limits (type, bytes, size) are the real ones. It doesn't re-encode, so a hand-made file keeps its metadata. That is the sender's own data.
- **Counted as characters,** so a picture adds nothing to a post's length, and a post with a picture earns the same points as one without.

## Alternatives

- **Add the picture to the existing `Post` type.** Changes the id and signature of every post already made.
- **Public blob addresses.** Simpler, and fast from a CDN, but a hidden post's picture would stay reachable to anyone with the address.
- **Pictures in Redis as base64.** A megabyte a post, 500 posts a Club: too much for a REST key-value store, and every read would carry them.
- **A link to a picture elsewhere.** Lets a post load a third party's address in every reader's browser (their IP, a tracking pixel, content that changes after signing).
- **A third-party emoji picker package.** A large dependency for a list of sixty.
