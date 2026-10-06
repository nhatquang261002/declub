# ADR 0028: Account avatars: an NFT you hold, or a picture

**Status:** Accepted · 2026-10-06 · Web only: no contract change. Builds on [ADR 0011](0011-verified-profiles.md) (verified profiles) and [ADR 0013](0013-privy-webhooks.md) (Privy webhooks).

## Context

Every wallet was drawn as a gradient from its address. On a Club's Board, Members list and Rewards table that makes people hard to tell apart, and in a product about NFT culture, showing the NFT you hold is the obvious picture.

## Decision

**A signed-in user sets one avatar on the Account page, either an NFT one of their linked wallets holds or an uploaded picture. It shows wherever the app draws one of their wallets.**

- **One avatar per sign-in.** It is written for every Ethereum wallet linked to the Privy user, like a shared profile. The same picture beside two wallets tells others they are the same person; the Account page says so.
- **NFT avatars are checked on the chain.** `PUT /api/avatar { nft }` reads `ownerOf` and refuses unless one of the user's linked wallets (read from Privy, never from the request) holds the token. The art is read on the server from the token's own `tokenURI` (inline, or fetched from a public https host only, as the trait scanner does), so nobody can pass off another picture as their NFT. `ipfs://` goes through a gateway; anything but https or an inline image is refused.
- **Shown only while held.** `GET /api/profiles` now also returns `avatars`; an NFT avatar whose holder no longer owns the token is left out (one multicall per lookup, behind the same 30-second CDN cache). It comes back if the token does. If the RPC can't be asked, avatars are shown: they are cosmetic.
- **Uploads are shrunk in the browser** to a 256 px centred square (WebP, else JPEG) and kept in the store (Upstash), at most 96 KB. The server checks the bytes match the claimed type (PNG, JPEG, WebP, GIF). NFT art that is an inline `data:` image is kept the same way, SVG included.
- **Kept pictures are served by `GET /api/avatars/[address]?v=…`** as inert files: `Content-Security-Policy: default-src 'none'; sandbox` and `nosniff`, so an SVG opened directly can't run scripts. The URL names a version, so it is cached for good and a new picture gets a new URL.
- **It follows the linked wallets.** The Privy webhook and the Account page re-sync it: a new wallet gets it, an unlinked one loses it, and an NFT avatar goes away entirely when the wallet holding it is unlinked.
- **Drawing.** `WalletAvatar` looks the avatar up with the profile (one batched request per tick) and lays the picture over the address gradient, which stays as the fallback if the image fails to load.

## What it does not do

- **No moderation.** An uploaded picture, like a post, is whatever the user chose. Removing one means deleting `declub:avatar-img:<userId>` and its rows by hand.
- **No avatar per wallet.** Someone who doesn't want their wallets tied together shouldn't set one.
- **It doesn't make anyone trusted.** Holding an NFT says nothing about who the holder is.
