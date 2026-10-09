import Image from "next/image";
import type { ReactNode } from "react";
import { initials, type ClubInfo } from "@/lib/clubs";

const THEMES = 5;

/**
 * Which of the brand covers in globals.css (`.club-theme-N`) a Club wears, from its address: the
 * same Club looks the same on every screen, and nobody has to pick a colour.
 */
function clubTheme(token: string): string {
  // Every byte of the address folded together, so any change to it can move the colour.
  const bytes = token.replace(/^0x/, "").match(/../g) ?? [];
  const n = bytes.reduce((acc, byte) => acc ^ (parseInt(byte, 16) || 0), 0);
  return `club-theme-${n % THEMES}`;
}

/**
 * The Club's face: its art when the assets list gives one, else its initials on its cover colours.
 * A collection is a rounded square and a token a coin, so the two read apart at a glance.
 */
export function ClubAvatar({
  club,
  className = "size-12 text-base",
  sizes = "48px",
}: {
  club: Pick<ClubInfo, "token" | "name" | "kind" | "image">;
  className?: string;
  /** For the image: how wide it is drawn, so the browser fetches a fitting size. */
  sizes?: string;
}) {
  return (
    <span aria-hidden className={`club-avatar ${clubTheme(club.token)} ${club.kind === "erc20" ? "club-avatar-coin" : ""} ${className}`}>
      {club.image ? <Image src={club.image} alt="" fill sizes={sizes} /> : <span className="relative z-10">{initials(club.name)}</span>}
    </span>
  );
}

/** A Club's banner: its cover colours with the symbol as a watermark (`markClassName` sizes it). */
export function ClubCover({
  club,
  className = "",
  markClassName = "",
  children,
}: {
  club: Pick<ClubInfo, "token" | "symbol">;
  className?: string;
  markClassName?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`club-cover ${clubTheme(club.token)} ${className}`}>
      <span aria-hidden className={`club-cover-mark ${markClassName}`}>
        {club.symbol}
      </span>
      {children}
    </div>
  );
}
