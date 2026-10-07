# 08 · Art Direction

DeClub looks like a pinboard of trading stickers: a cream canvas, thick dark outlines, red tape
and warm Chog-brand colours. The brand's rules and files are in `15-brand-kit.md` and `brand/`. The supplied Chog artwork adds an expressive, collectible
mood, while trade terms, wallet state and transaction actions stay clear.

## Visual language

The tokens are in `web/app/globals.css`: brand primitives (`--chog-*`) feed semantic tokens
(`--surface-*`, `--content-*`, `--action-*`), and components use the semantic ones.

- **Canvas and panels:** warm paper surfaces, dark ink outlines and red tape accents, with no shadows.
- **Buttons:** bold bordered controls use the same outline-and-tilt language, with distinct primary,
  secondary and danger treatments.
- **Type:** Geist and Geist Mono for the interface, Bricolage Grotesque (800) for the wordmark.
- **Header:** a dark translucent bar (`--surface-overlay`) carrying the logo.

## Logo and icons

- The logo is drawn inline in `web/components/Logo.tsx`; the favicon is the same mark in
  `web/app/icon.svg`. Keep the two in sync.
- `web/public/brand/` holds the supplied Chog logo set. The app uses the face badge
  (`Badge_(Face_Chog)/FACE_CHOG.svg`, on the home page and Club pages) and `mon.svg` (the MON
  token icon in deal and asset rows).

## Artwork

- Supplied NFT examples live under `web/public/art/chogs/`.
- The home page shows the Angel/Devil swap illustration, `DeClubArt` in
  `web/components/ChogArt.tsx`: Angel Chog #1159 and Devil Chog #1376 in taped white frames with
  swap arrows.
- `ChogImage` (`web/components/Chog.tsx`) is only used for tokens of the configured Chog collection
  (`CHOG_ADDRESS`). It shows the token's `tokenURI` image, with the local artwork as a fallback for
  the five sample ids. Other NFTs show their own metadata image.
- The sample art is decoration. It does not imply ownership, availability or on-chain metadata for
  those images; live deals always show the token's own metadata.
