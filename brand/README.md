# De(al) Club brand kit

Open `brand-kit.html` for the visual sheet; the rules are in `../docs/brand-kit.md`.

- `logo/` – SVG mark, glyphs, wordmarks and lockups (text outlined, no font needed)
- `png/` – the same, rasterised
- `social/` – X avatar, X header and link preview (sources in `social/src/`)
- `build/` – regenerates all of the above
- `build/stickers.py` – the twelve default stickers every Club has (ADR 0057), into `web/public/stickers` (needs `fonttools` only)

To regenerate (needs `fonttools` and `uharfbuzz`; `sharp` comes from `web/node_modules`):

    python3 -m venv .venv && .venv/bin/pip install fonttools uharfbuzz
    .venv/bin/python brand/build/make.py
    cd web && node ../brand/build/render.mjs
