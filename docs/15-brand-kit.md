# 15 · Brand Kit

How De(al) Club looks and sounds, and the files to build with. `08-art-direction.md` explains how the
app implements the look; this is the version for anyone making something outside the app: a thread, a
slide, a poster, a video.

Open `brand/brand-kit.html` for the visual sheet. The files are in `brand/`.

## The idea

**Communities that own their market.** DeClub is a pinboard of trading stickers: cream paper, thick
ink outlines, a red strip of tape, warm gold for the one thing to press. It is playful, but money moves
here, so every claim about assets, fees and rewards is plain and literal.

| Use | Line |
|---|---|
| Tagline | Communities that own their market. |
| Headline | Your community’s market, owned by its members. |
| One-liner | Clubs, swaps and rewards for Monad’s NFT collections and their coins. |

## The name

- **De(al) Club** is the wordmark. Use it in the logo, the home hero and the page `<title>`.
- **DeClub** everywhere else: body copy, code, contracts, env vars, filenames, handles.
- In running text the product's own things are capitalised: Club, Holder, Owner, Board, Momentum, Heat.
- Never write “On Deal” (the old name) outside historical records, and never “Declub”, “DECLUB” or
  “De(al)Club”.

## Logo

Files in `brand/logo/` (SVG, text already outlined) and `brand/png/`.

| File | Use it for |
|---|---|
| `logo-on-dark.svg` | Dark backgrounds, the app header. Cream wordmark. |
| `logo-on-light.svg` | Cream, white or photo backgrounds. Ink wordmark. |
| `mark.svg` | App icon, avatars, anywhere the tile stands alone. The same drawing as `web/app/icon.svg`. |
| `mark-ink.svg` | The mark on white paper or in print, when a cream tile would look washed out. |
| `glyph-ink.svg`, `glyph-cream.svg` | One colour, no tile: a stamp, an emboss, a watermark. |
| `wordmark-ink.svg`, `wordmark-cream.svg` | The words alone, when the mark is already on the page. |

- **Anatomy.** A “D” with a dot set into its bowl, on a rounded tile with its own ink outline. In the
  wordmark, “(al)” is smaller and 60% opacity, so it reads “Deal” inside “De(al) Club”.
- **Clear space.** A quarter of the tile's height on every side.
- **Minimum size.** Mark 16 px. Full logo 120 px wide. Below that, use the mark.
- **Don't.** Recolour it; stretch or rotate it; add shadows or glows; drop the dot; set the wordmark in
  Geist or any other face; put the tile on a background that swallows its outline; write “(al)” at full
  strength.

## Colour

The values live in `web/app/globals.css`; `brand/build/make.py` refuses to run if they drift.
The code calls the dark colours `--chog-purple-*`, but they are blue-black: use the kit's names.

| Name | Hex | Token | Role |
|---|---|---|---|
| Ink | `#111318` | `--chog-purple-950`, `--content-primary` | Text, outlines, the mark |
| Night | `#171a22` | `--chog-purple-900`, `--surface-raised` | Dark panels, header, footer |
| Slate | `#202735` | `--chog-purple-800` | Controls on dark |
| Cream | `#fff4cf` | `--chog-cream-500` | Panels and stickers |
| Canvas | `#f4edda` | `--surface-canvas` | The page |
| Gold | `#f0b735` | `--chog-peach-500` | The primary action, the active tab |
| Red | `#d83b45` | `--action-primary` | Accent, tape, the “want” side |
| Deep Red | `#a9282f` | `--chog-pink-700` | Small red text and links on cream |
| Blue | `#315ea8` | `--chog-purple-500` | Info, link hover, “filled” |
| Mint | `#78c7a5` on dark, `#1f7a55` on cream | `--feedback-success` | Success, verified |

Ink and cream carry the page. Gold is for the single thing to press. Red is for emphasis, not for
body text. Blue and mint are signals, never decoration.

**Contrast** (WCAG; AA needs 4.5 for body text, 3 for large text and icons):

| Pair | Ratio | |
|---|---|---|
| Ink on Cream | 16.9 | Pass |
| Ink on Gold | 10.2 | Pass |
| Cream on Night | 15.8 | Pass |
| Gold on Night | 9.6 | Pass |
| `#4e5968` (muted) on Cream | 6.5 | Pass |
| Deep Red on Cream | 6.3 | Pass |
| White on Red | 4.5 | Pass, barely: bold text only |
| **Red on Cream** | **4.1** | **Large text, icons and tape only** |
| **Red on Night** | **3.8** | **Large text and icons only** |

So Red is for headlines and shapes. Small red text uses Deep Red on cream.
The numbered steps on the home page (`text-accent`, 14 px) currently break this rule.

## Type

- **Bricolage Grotesque ExtraBold** is the wordmark's face and nothing else. Don't use it for
  headings. The logo files already have it outlined.
- **Geist** is the interface and body face; **Geist Mono** is for addresses, IDs, counts and labels
  that should look machine-made. Both are free on Google Fonts.
- Headings are heavy (800–900) with tight tracking (−0.02 to −0.04em) and a line height near 1. The
  hero is 36 px on a phone and 60 px on a desktop; a deal title is 34–54 px.
- Small labels are 11 px, weight 800, uppercase, 0.1–0.16em tracking (`.kicker`, `.eyebrow`).
- Numbers are tabular (`font-variant-numeric: tabular-nums`) so columns line up.

## Shape and surface

- **Outlines.** 2 px Ink on every panel, card, button and menu. This is the brand's strongest cue.
- **Radii.** 12 px controls, 16 px cards, 24 px big panels, 32 px hero. Pills and avatars are fully round.
- **Paper.** Cream panels on the Canvas, with a 14 px dot grid on big sheets.
- **Tape.** A 64 × 18 px Red strip at 82% opacity, tilted −2°, on top of one panel per page.
  “A page of tape is noise.”
- **Stamps.** Status is a double-ruled, slightly crooked rubber stamp.
- **No shadows.** The old hard offset shadows were removed (commit `34d261a`). Depth comes from the
  outline, a small tilt and overlap.
- **Motion.** Buttons lift and tilt a little on hover and squash on press. All of it stops under
  `prefers-reduced-motion`.
- **Club covers.** Each Club gets one of five two-colour covers (Gold, Red, Slate–Blue, Mint, Blue)
  chosen from its address, so it looks the same everywhere. Don't recolour a Club to match a campaign.

## Chog artwork

The Chog badges, logos and NFT samples (`web/public/brand/`, `web/public/art/chogs/`) were supplied
to the project; they are not DeClub marks. Use them unaltered, as decoration, and never in a way that
implies someone owns, sells or endorses a specific Chog. **To confirm:** the licence for use outside
the app (marketing, merch, the submission videos).

## Voice

What the app already does, and should keep doing:

- Short, direct, warm. Say what happens and what it costs. “Each completed swap pays a small fee.”
- Name the money rule exactly: percentages and caps come from `REWARDS`, never rounded in copy.
- Safety is a statement, not a disclaimer wall: “Assets move only in transactions or signatures you
  approve.”
- Never promise returns. Rewards are a share of fees, paid in MON, to the Club's active Holders (those with enough points that week).
- Say “swap” and “deal” for a trade, “Holder” for someone who owns a Club's NFT, “Owner” for the
  person who runs the Club.

Proposed, not yet in the app: no slang that dates it (“moon”, “wen”, “ape”); a joke is fine, a joke
about someone's money is not; the tape-and-sticker look carries the fun, so the words can stay plain.

## Social

Ready-made in `brand/social/` (sources in `social/src/`).

| File | Size | For |
|---|---|---|
| `avatar-400.png` | 400 × 400 | Profile picture. The mark has room to spare for a circular crop. |
| `x-header-1500x500.png` | 1500 × 500 | X header. |
| `link-preview-1200x630.png` | 1200 × 630 | Link preview image. |

The app does not use the link preview yet: `layout.tsx` sets no `openGraph.images`. The domain is not
printed on any image until it is final.

## Keeping it true

- Colours, the favicon and `Logo.tsx` are the source. Change them first, then run the build:
  `python3 -m venv .venv && .venv/bin/pip install fonttools uharfbuzz && .venv/bin/python brand/build/make.py`
  and then `cd web && node ../brand/build/render.mjs`.
- `make.py` stops if a brand colour is missing from `globals.css`, or if `icon.svg` or `Logo.tsx` no
  longer match the mark.
- The swatches in `brand-kit.html` are written by hand: update them with the table above.
