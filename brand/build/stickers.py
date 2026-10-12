"""Builds the default stickers every Club has (ADR 0057): web/public/stickers/<name>.svg.

    python3 -m venv .venv && .venv/bin/pip install fonttools
    .venv/bin/python brand/build/stickers.py

Each is a 512 x 512 SVG drawn only from shapes and outlined text (Bricolage Grotesque ExtraBold, the
face of the wordmark), so it renders the same with no font installed and carries no script, image or
link. The colours are the brand's and are checked against web/app/globals.css. The names must equal
DEFAULT_STICKERS in web/lib/clubPack.ts, which a test also checks.
"""

import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web/public/stickers"
FONT_PATH = ROOT / "web/assets/fonts/BricolageGrotesque-ExtraBold.ttf"

INK = "#111318"
CREAM = "#fff4cf"
GOLD = "#f0b735"
RED = "#d83b45"
BLUE = "#315ea8"
WHITE = "#ffffff"

_font = TTFont(FONT_PATH)
_glyphs = _font.getGlyphSet()
_cmap = _font.getBestCmap()
_cap = _font["OS/2"].sCapHeight


def check_against_app() -> None:
    css = (ROOT / "web/app/globals.css").read_text().lower()
    for name, value in dict(INK=INK, CREAM=CREAM, GOLD=GOLD, RED=RED, BLUE=BLUE).items():
        if value.lower() not in css:
            sys.exit(f"{name} {value} is not in web/app/globals.css: update the stickers or the app")


def text(label: str, cx: float, cy: float, width: float, fill: str) -> str:
    """`label` as one outlined path, as wide as `width` and centred on (cx, cy) by its capital height."""
    advances = [_font["hmtx"][_cmap[ord(c)]][0] for c in label]
    scale = width / sum(advances)
    x = cx - width / 2
    baseline = cy + _cap * scale / 2
    parts = []
    for char, adv in zip(label, advances):
        pen = SVGPathPen(_glyphs)
        _glyphs[_cmap[ord(char)]].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        parts.append(pen.getCommands())
        x += adv * scale
    return f'<path fill="{fill}" d="{" ".join(parts)}"/>'


def sparkle(cx: float, cy: float, r: float, fill: str) -> str:
    """A four-point star."""
    k = r * 0.28
    pts = [(cx, cy - r), (cx + k, cy - k), (cx + r, cy), (cx + k, cy + k), (cx, cy + r), (cx - k, cy + k), (cx - r, cy), (cx - k, cy - k)]
    return f'<polygon points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}" fill="{fill}" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>'


def svg(body: str, angle: float = 0) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">'
        f'<g transform="rotate({angle} 256 256)">{body}</g></svg>\n'
    )


def badge(label: str, bg: str, fg: str, angle: float, extra: str = "", width: float = 330, dy: float = 0) -> str:
    """A rounded tag with the label on it: a flat ink shadow, a white die-cut edge, an ink outline."""
    x, y, w, h, r = 56, 116, 400, 280, 64
    shape = f'x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}"'
    return svg(
        f'<rect {shape} fill="{INK}" transform="translate(12 16)" stroke="{INK}" stroke-width="44" stroke-linejoin="round"/>'
        f'<rect {shape} fill="{WHITE}" stroke="{WHITE}" stroke-width="44" stroke-linejoin="round"/>'
        f'<rect {shape} fill="{bg}" stroke="{INK}" stroke-width="14"/>'
        f'<rect x="{x + 22}" y="{y + 22}" width="{w - 44}" height="{h - 44}" rx="{r - 22}" fill="none" stroke="{fg}" stroke-opacity="0.35" stroke-width="5" stroke-dasharray="3 14" stroke-linecap="round"/>'
        + text(label, 256, 256 + dy, width, fg)
        + extra,
        angle,
    )


def gem() -> str:
    outline = "160,150 352,150 432,262 256,448 80,262"
    facets = "".join(
        f'<polyline points="{p}" fill="none" stroke="{INK}" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>'
        for p in ("80,262 432,262", "160,150 208,262 256,448 304,262 352,150", "208,262 256,150 304,262")
    )
    return svg(
        f'<polygon points="{outline}" fill="{INK}" stroke="{INK}" stroke-width="44" stroke-linejoin="round" transform="translate(12 16)"/>'
        f'<polygon points="{outline}" fill="{WHITE}" stroke="{WHITE}" stroke-width="44" stroke-linejoin="round"/>'
        f'<polygon points="{outline}" fill="{BLUE}" stroke="{INK}" stroke-width="14" stroke-linejoin="round"/>'
        f'<polygon points="160,150 352,150 432,262 80,262" fill="{CREAM}"/>'
        f'<polygon points="208,262 256,150 304,262" fill="{GOLD}"/>' + facets + sparkle(404, 128, 38, GOLD) + sparkle(112, 372, 26, CREAM),
        -4,
    )


def arrow(x1: float, x2: float, y: float, fill: str) -> str:
    """A thick arrow from x1 to x2 (either way) at height y."""
    d = 1 if x2 > x1 else -1
    head = x2 - d * 64
    pts = [(x1, y - 28), (head, y - 28), (head, y - 66), (x2, y), (head, y + 66), (head, y + 28), (x1, y + 28)]
    return f'<polygon points="{" ".join(f"{px:.1f},{py:.1f}" for px, py in pts)}" fill="{fill}" stroke="{INK}" stroke-width="14" stroke-linejoin="round"/>'


def swap() -> str:
    return svg(
        f'<circle cx="256" cy="256" r="196" fill="{INK}" transform="translate(12 16)"/>'
        f'<circle cx="256" cy="256" r="196" fill="{WHITE}" stroke="{WHITE}" stroke-width="40"/>'
        f'<circle cx="256" cy="256" r="196" fill="{CREAM}" stroke="{INK}" stroke-width="14"/>'
        + arrow(130, 390, 200, RED)
        + arrow(382, 122, 312, BLUE)
        + sparkle(402, 112, 30, GOLD),
        5,
    )


# name -> the sticker's SVG. Keep in step with DEFAULT_STICKERS in web/lib/clubPack.ts.
def stickers() -> dict[str, str]:
    star = sparkle(420, 124, 36, GOLD)
    return {
        "gm": badge("GM", GOLD, INK, -5, f'<circle cx="112" cy="156" r="30" fill="{CREAM}" stroke="{INK}" stroke-width="8"/>', 280),
        "gn": badge("GN", BLUE, WHITE, 4, sparkle(104, 150, 30, GOLD) + sparkle(412, 360, 22, CREAM), 280),
        "lfg": badge("LFG!", RED, WHITE, -4, star),
        "wagmi": badge("WAGMI", CREAM, INK, 3, f'<rect x="120" y="326" width="272" height="16" rx="8" fill="{RED}" stroke="{INK}" stroke-width="6"/>', 360, -22),
        "wen": badge("WEN?", WHITE, INK, -3, sparkle(404, 150, 30, RED), 320),
        "hodl": badge("HODL", BLUE, WHITE, 5, star, 340),
        "gg": badge("GG", GOLD, INK, -4, sparkle(112, 360, 28, WHITE), 260),
        "wtb": badge("WTB", RED, WHITE, 3, sparkle(412, 150, 30, GOLD), 320),
        "wts": badge("WTS", BLUE, WHITE, -3, sparkle(412, 150, 30, GOLD), 320),
        "deal": badge("DEAL!", GOLD, INK, -4, sparkle(104, 156, 30, WHITE) + sparkle(408, 360, 24, RED), 350),
        "gem": gem(),
        "swap": swap(),
    }


def main() -> None:
    check_against_app()
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.svg"):
        old.unlink()
    made = stickers()
    for name, body in made.items():
        (OUT / f"{name}.svg").write_text(body)
    print(f"wrote {len(made)} stickers to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
