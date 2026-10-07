"""Builds the SVG half of the brand kit: logo files and the sources of the social images.

    python3 -m venv .venv && .venv/bin/pip install fonttools uharfbuzz
    .venv/bin/python brand/build/make.py && (cd web && node ../brand/build/render.mjs)

Text is turned into outlines with Bricolage Grotesque ExtraBold (the face of the wordmark, in
web/assets/fonts), so every file renders the same with no font installed. The colours below must stay
equal to web/app/globals.css; the script checks that.
"""

import re
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / "brand"
FONT_PATH = ROOT / "web/assets/fonts/BricolageGrotesque-ExtraBold.ttf"

# Brand colours -> where they live in globals.css. The kit's names are on the left.
INK = "#111318"
NIGHT = "#171a22"
SLATE = "#202735"
CREAM = "#fff4cf"
CANVAS = "#f4edda"
GOLD = "#f0b735"
RED = "#d83b45"
DEEP_RED = "#a9282f"
BLUE = "#315ea8"
WHITE = "#ffffff"

TAGLINE = "Communities that own their market."

# The mark, as drawn in web/components/Logo.tsx and web/app/icon.svg (40 x 40).
D_PATH = "M12.5 10h8c6.500 0 10 4 10 10s-3.500 10-10 10h-8zM17.500 15v10h2.500c3 0 4.800-2 4.800-5s-1.800-5-4.800-5z"


def check_against_app() -> None:
    css = (ROOT / "web/app/globals.css").read_text()
    for name, value in dict(INK=INK, NIGHT=NIGHT, SLATE=SLATE, CREAM=CREAM, CANVAS=CANVAS, GOLD=GOLD,
                            RED=RED, DEEP_RED=DEEP_RED, BLUE=BLUE).items():
        if value.lower() not in css.lower():
            sys.exit(f"{name} {value} is not in web/app/globals.css: update the brand kit or the app")
    icon = (ROOT / "web/app/icon.svg").read_text()
    if D_PATH not in icon or CREAM not in icon:
        sys.exit("web/app/icon.svg no longer matches the mark in this script: update them together")
    logo = (ROOT / "web/components/Logo.tsx").read_text()
    if D_PATH not in logo:
        sys.exit("web/components/Logo.tsx no longer matches the mark in this script: update them together")


# ── Text as outlines ────────────────────────────────────────────────────────────────────────────

_ttfont = TTFont(FONT_PATH)
_glyphs = _ttfont.getGlyphSet()
_upem = _ttfont["head"].unitsPerEm
_order = _ttfont.getGlyphOrder()
_hb_font = hb.Font(hb.Face(hb.Blob.from_file_path(str(FONT_PATH))))
_hhea = _ttfont["hhea"]


def outline(text: str, size: float, x: float, baseline: float, tracking_em: float = -0.04) -> tuple[str, float]:
    """The outlined path of `text` (kerned, tracked) and the x where it ends, trailing tracking removed."""
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(_hb_font, buf, {"kern": True, "liga": True})
    scale = size / _upem
    track = tracking_em * size
    pen_x = x
    d: list[str] = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = _order[info.codepoint]
        svg = SVGPathPen(_glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
        _glyphs[name].draw(TransformPen(svg, (scale, 0, 0, -scale, pen_x + pos.x_offset * scale, baseline)))
        if svg.getCommands():
            d.append(svg.getCommands())
        pen_x += pos.x_advance * scale + track
    return "".join(d), pen_x - track


def wordmark(size: float, x: float, baseline: float, color: str) -> tuple[str, float]:
    """'De(al) Club': a smaller, dimmed '(al)' reads it as 'Deal' (see Wordmark in Logo.tsx)."""
    small = size * 0.8
    track = -0.04 * size  # letter-spacing is inherited as a length, so "(al)" tracks like the rest
    margin = 0.04 * small  # mx-[0.04em] on the 0.8em span
    de, x1 = outline("De", size, x, baseline)
    al, x2 = outline("(al)", small, x1 + track + margin, baseline, tracking_em=track / small)
    club, x3 = outline(" Club", size, x2 + track + margin, baseline)
    paths = (
        f'<path fill="{color}" d="{de}"/>'
        f'<path fill="{color}" fill-opacity="0.6" d="{al}"/>'
        f'<path fill="{color}" d="{club}"/>'
    )
    return paths, x3


def baseline_for(size: float, top: float, box: float) -> float:
    """The baseline of a line-height:1 line of `size` centred in a box of `box` starting at `top`."""
    asc = _hhea.ascent / _upem * size
    desc = -_hhea.descent / _upem * size
    return top + (box - (asc + desc)) / 2 + asc


# ── Mark variants ───────────────────────────────────────────────────────────────────────────────

def mark_inner(tile: str, tile_stroke: str, d_fill: str, dot_fill: str, dot_stroke: str) -> str:
    return (
        f'<rect x="2" y="2" width="36" height="36" rx="10" fill="{tile}" stroke="{tile_stroke}" stroke-width="2.5"/>'
        f'<path fill="{d_fill}" fill-rule="evenodd" stroke="{d_fill}" stroke-width="1.5" stroke-linejoin="round" d="{D_PATH}"/>'
        f'<circle cx="27" cy="13.5" r="3.4" fill="{dot_fill}" stroke="{dot_stroke}" stroke-width="2"/>'
    )


def svg(view: str, body: str, title: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" fill="none" role="img">'
        f"<title>{title}</title>{body}</svg>\n"
    )


def glyph(color: str, uid: str) -> str:
    """The D and its dot with no tile: the dot is a ring, with the D cut away inside and around it."""
    return (
        f'<mask id="{uid}" maskUnits="userSpaceOnUse" x="0" y="0" width="40" height="40">'
        f'<rect width="40" height="40" fill="#fff"/><circle cx="27" cy="13.5" r="4.4" fill="#000"/></mask>'
        f'<path mask="url(#{uid})" fill="{color}" fill-rule="evenodd" stroke="{color}" stroke-width="1.5" '
        f'stroke-linejoin="round" d="{D_PATH}"/>'
        f'<circle cx="27" cy="13.5" r="3.4" stroke="{color}" stroke-width="2"/>'
    )


def lockup(tile_body: str, color: str) -> tuple[str, str]:
    """The header logo: 40px tile, 10px gap, wordmark at 1.7rem (27.2px), as Logo.tsx sets it."""
    size = 27.2
    marks, end = wordmark(size, 50, baseline_for(size, 0, 40), color)
    return f"0 0 {end + 2:.1f} 40", tile_body + marks


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


# ── Social images ───────────────────────────────────────────────────────────────────────────────

def banner() -> str:
    """X header, 1500 x 500. Dark, with the footer's loose circles. The content sits on the right edge
    and the circles on the left, because X's avatar covers the bottom left of the header."""
    w, h = 1500, 500
    s = 4.0  # the 40-unit tile at 160px
    edge = 1390  # right edge of the content
    size = 27.2 * s * 1.05
    gap = 10 * s * 1.05
    paths, end = wordmark(size, 0, baseline_for(size, 0, 40 * s), CREAM)
    x0 = edge - (40 * s + gap + end)
    lock = (
        f'<g transform="translate({x0:.1f} 130)">'
        f'<g transform="scale({s})">{mark_inner(CREAM, INK, INK, CREAM, INK)}</g>'
        f'<g transform="translate({40 * s + gap:.1f} 0)">{paths}</g></g>'
    )
    tag, tag_end = outline(TAGLINE, 44, 0, 0, tracking_em=-0.02)
    body = (
        f'<rect width="{w}" height="{h}" fill="{NIGHT}"/>'
        f'<circle cx="170" cy="-10" r="190" stroke="{BLUE}" stroke-opacity="0.4" stroke-width="64"/>'
        f'<circle cx="320" cy="520" r="170" fill="{RED}" fill-opacity="0.14"/>'
        f"{lock}"
        f'<path transform="translate({edge - tag_end:.1f} 380)" fill="{GOLD}" d="{tag}"/>'
    )
    return svg(f"0 0 {w} {h}", body, "De(al) Club header")


def og() -> str:
    """Link preview, 1200 x 630. A taped cream sticker on the paper canvas."""
    w, h = 1200, 630
    s = 3.4
    tile_w = 40 * s
    size = 27.2 * s
    gap = 10 * s
    paths, end = wordmark(size, 0, baseline_for(size, 0, tile_w), INK)
    total = tile_w + gap + end
    x0 = (w - total) / 2
    lock = (
        f'<g transform="translate({x0:.1f} 190)">'
        f'<g transform="scale({s})">{mark_inner(CREAM, INK, INK, CREAM, INK)}</g>'
        f'<g transform="translate({tile_w + gap:.1f} 0)">{paths}</g></g>'
    )
    tag_size = 46
    tag, tag_end = outline(TAGLINE, tag_size, 0, 0, tracking_em=-0.02)
    tag_x = (w - tag_end) / 2
    body = (
        f'<rect width="{w}" height="{h}" fill="{CANVAS}"/>'
        f'<rect x="70" y="70" width="{w - 140}" height="{h - 140}" rx="36" fill="{CREAM}" stroke="{INK}" stroke-width="6"/>'
        f'<rect x="{w / 2 - 80:.0f}" y="48" width="160" height="44" fill="{RED}" fill-opacity="0.82" '
        f'transform="rotate(-2 {w / 2:.0f} 70)"/>'
        f"{lock}"
        f'<path transform="translate({tag_x:.1f} 440)" fill="{DEEP_RED}" d="{tag}"/>'
    )
    return svg(f"0 0 {w} {h}", body, "De(al) Club link preview")


def avatar() -> str:
    """Profile picture, 400 x 400. The mark with room to spare, so a circular crop keeps all of it."""
    s = 6.0
    off = (400 - 40 * s) / 2
    body = (
        f'<rect width="400" height="400" fill="{NIGHT}"/>'
        f'<g transform="translate({off} {off}) scale({s})">{mark_inner(CREAM, INK, INK, CREAM, INK)}</g>'
    )
    return svg("0 0 400 400", body, "De(al) Club avatar")


def main() -> None:
    check_against_app()
    logo = BRAND / "logo"

    tiles = {
        "mark": mark_inner(CREAM, INK, INK, CREAM, INK),
        "mark-ink": mark_inner(INK, INK, CREAM, INK, CREAM),
    }
    write(logo / "mark.svg", svg("0 0 40 40", tiles["mark"], "De(al) Club mark"))
    write(logo / "mark-ink.svg", svg("0 0 40 40", tiles["mark-ink"], "De(al) Club mark, ink tile"))
    write(logo / "glyph-ink.svg", svg("0 0 40 40", glyph(INK, "cut"), "De(al) Club glyph"))
    write(logo / "glyph-cream.svg", svg("0 0 40 40", glyph(CREAM, "cut"), "De(al) Club glyph"))

    for name, color in (("cream", CREAM), ("ink", INK)):
        marks, end = wordmark(100, 0, baseline_for(100, 0, 100), color)
        write(logo / f"wordmark-{name}.svg", svg(f"-2 0 {end + 4:.1f} 100", marks, "De(al) Club"))

    view, body = lockup(tiles["mark"], CREAM)
    write(logo / "logo-on-dark.svg", svg(view, body, "De(al) Club"))
    view, body = lockup(tiles["mark"], INK)
    write(logo / "logo-on-light.svg", svg(view, body, "De(al) Club"))

    write(BRAND / "social/src/x-header.svg", banner())
    write(BRAND / "social/src/link-preview.svg", og())
    write(BRAND / "social/src/avatar.svg", avatar())
    print("svg written")


if __name__ == "__main__":
    main()
