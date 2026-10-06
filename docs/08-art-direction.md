# 08 · Art Direction

DeClub looks like a pinboard of trading stickers: a cream canvas, thick dark outlines, hard offset
shadows and warm Chog-brand colours. The supplied Chog artwork adds an expressive, collectible
mood, while trade terms, wallet state and transaction actions stay clear.

## Visual language

The tokens are in `web/app/globals.css`: brand primitives (`--chog-*`) feed semantic tokens
(`--surface-*`, `--content-*`, `--action-*`), and components use the semantic ones.

- **Canvas:** cream (`--surface-canvas`, `#f4edda`) under dark ink text (`#111318`).
- **Panels:** `page-section` is a cream card (`#fff4cf`) with a 2px `#111318` border, a hard
  offset shadow and a strip of red "tape" on top. `hero-panel` is the larger cream-to-peach
  gradient panel on the home page. Deal cards (`deal-card`) follow the same style and lift with a
  blue shadow on hover.
- **Buttons:** `btn` has a 2px dark border and a hard offset shadow that grows and tilts on hover
  and squashes when pressed. `btn-primary` is gold/peach (`#f0b735`) with a pink-red (`#d83b45`)
  shadow, `btn-secondary` is white, `btn-danger` is white with dark-red text, border and shadow.
- **Type:** Geist and Geist Mono for the interface, Bricolage Grotesque (800) for the wordmark.
- **Header:** a dark translucent bar (`--surface-overlay`) carrying the logo.

## Logo and icons

- The logo is drawn inline in `web/components/Logo.tsx`: `LogoMark` (two arrows passing each
  other on a cream tile with a red hard shadow) and `Wordmark` (white "On", gold "Deal", pink
  shadow). The favicon is the same mark in `web/app/icon.svg`; keep the two in sync.
- `web/public/brand/` holds the supplied Chog logo set. The app uses the face badge
  (`Badge_(Face_Chog)/FACE_CHOG.svg`, on the home page and Club pages) and `mon.svg` (the MON
  token icon in deal and asset rows).

## Artwork

- Supplied NFT examples live under `web/public/art/chogs/`.
- The home page shows the Angel/Devil swap illustration, `DeClubArt` in
  `web/components/ChogArt.tsx`: Angel Chog #1159 and Devil Chog #1376 in taped white frames with
  swap arrows.
- `PinnedChog` (a pinboard collage) is still in `web/components/` but no page uses it.
- `ChogImage` (`web/components/Chog.tsx`) is only used for tokens of the configured Chog collection
  (`CHOG_ADDRESS`). It shows the token's `tokenURI` image, with the local artwork as a fallback for
  the five sample ids. Other NFTs show their own metadata image.
- The sample art is decoration. It does not imply ownership, availability or on-chain metadata for
  those images; live deals always show the token's own metadata.
