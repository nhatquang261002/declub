import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReactNode } from "react";
import { SITE_URL } from "@/lib/config";

/** What every share card (a deal, a Club's recap) is drawn with, so they read as one family. */
export const CARD_SIZE = { width: 1200, height: 630 };

export const INK = "#111318";
export const YELLOW = "#f0b735";
export const CREAM = "#fff8e6";
export const BLUE = "#315ea8";
export const GREEN = "#7bd8a4";
export const PINK = "#d83b45";

/** The host the card signs off with: wherever the app is served (NEXT_PUBLIC_SITE_URL), never a guess. */
const SITE_HOST = new URL(SITE_URL).host;

const FONT = "Bricolage";
let font: Promise<Buffer> | undefined;

/**
 * The brand font at weight 800. The default font of `next/og` has one weight, so without this
 * every "bold" on a card renders thin. Read once, from the repo, so a card never waits on a network.
 */
export function cardFonts() {
  font ??= readFile(path.join(process.cwd(), "assets/fonts/BricolageGrotesque-ExtraBold.ttf"));
  return font.then((data) => [{ name: FONT, data, weight: 800 as const, style: "normal" as const }]);
}

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml" };

/**
 * An image the app ships under `public/` (a Club's art, the MON mark), as a data URI the card can
 * draw: read from the repo, so there's no fetch. `null` when there is none, or it isn't a format the
 * card can draw (webp): an avatar then shows a letter instead.
 */
export async function publicImage(image?: string): Promise<string | null> {
  const type = image && IMAGE_TYPES[image.split(".").pop()?.toLowerCase() ?? ""];
  if (!image || !type) return null;
  const root = path.join(process.cwd(), "public");
  const file = path.join(root, image);
  if (!file.startsWith(root + path.sep)) return null;
  try {
    return `data:${type};base64,${(await readFile(file)).toString("base64")}`;
  } catch {
    return null;
  }
}

/** The Club's round avatar: its art, or the first letter of its name when it has none. */
export function Avatar({ src, name, size }: { src: string | null; name: string; size: number }) {
  const frame = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: size,
    height: size,
    border: `${Math.max(4, size / 18)}px solid ${INK}`,
    borderRadius: 999,
    overflow: "hidden",
    background: YELLOW,
  } as const;
  if (src)
    return (
      <div style={frame}>
        {/* eslint-disable-next-line @next/next/no-img-element -- drawn by satori, not rendered in a page */}
        <img src={src} width={size} height={size} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    );
  return <div style={{ ...frame, fontSize: size * 0.5 }}>{(name.match(/[\p{L}\p{N}]/u)?.[0] ?? "•").toUpperCase()}</div>;
}

function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect x="2" y="2" width="36" height="36" rx="10" fill="#fff4cf" stroke={INK} strokeWidth="2.5" />
      <path
        fill={INK}
        fillRule="evenodd"
        stroke={INK}
        strokeWidth="1.5"
        strokeLinejoin="round"
        d="M12.5 10h8c6.5 0 10 4 10 10s-3.5 10-10 10h-8zM17.5 15v10H20c3 0 4.8-2 4.8-5S23 15 20 15z"
      />
      <circle cx="27" cy="13.5" r="3.4" fill="#fff4cf" stroke={INK} strokeWidth="2" />
    </svg>
  );
}

export function Pill({ children, fill = YELLOW, size = 30 }: { children: ReactNode; fill?: string; size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        border: `5px solid ${INK}`,
        borderRadius: 999,
        background: fill,
        padding: "8px 26px",
        fontSize: size,
        fontWeight: 800,
        letterSpacing: 1,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The card's frame: a dark border around a cream sheet with a header (the wordmark and whatever the
 * card says about itself on the right) and a footer line, and the card's own content in between.
 */
export function CardFrame({ badge, footer, children }: { badge: ReactNode; footer: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: INK, color: INK, padding: 30, fontFamily: FONT }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          position: "relative",
          overflow: "hidden",
          borderRadius: 28,
          background: CREAM,
          padding: "40px 46px 34px",
        }}
      >
        <div
          style={{
            display: "flex",
            position: "absolute",
            right: -100,
            bottom: -210,
            width: 500,
            height: 500,
            border: `42px solid ${YELLOW}`,
            borderRadius: 999,
            opacity: 0.4,
          }}
        />
        <div style={{ display: "flex", position: "absolute", left: -110, top: 150, width: 240, height: 240, borderRadius: 999, background: `${BLUE}1f` }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <LogoMark />
            <div style={{ display: "flex", fontSize: 38 }}>De(al) Club</div>
          </div>
          {badge}
        </div>
        {children}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 26 }}>
          <span>{footer}</span>
          <span style={{ display: "flex", color: BLUE }}>{SITE_HOST}</span>
        </div>
      </div>
    </div>
  );
}
