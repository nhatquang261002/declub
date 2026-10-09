"use client";

import Link from "next/link";
import { useState } from "react";
import { useAvatar } from "@/hooks/useProfiles";
import { profilePath } from "@/lib/about";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * A round avatar: the picture the wallet's owner chose (ADR 0028), else colours that come from the
 * address, so a wallet looks the same everywhere. With `link`, it opens that wallet's profile
 * (ADR 0042); leave it off inside a link or a button.
 */
export function WalletAvatar({ seed, size = "1.9rem", link = false, children }: { seed?: string; size?: string; link?: boolean; children?: React.ReactNode }) {
  const avatar = useAvatar(seed && ADDRESS.test(seed) ? seed : undefined);
  // A picture that won't load (a dead host, a gateway timeout) falls back to the colours.
  const [broken, setBroken] = useState<string>();
  const image = avatar && avatar.image !== broken ? avatar.image : undefined;
  const n = seed ? parseInt(seed.replace(/^0x/, "").slice(0, 8), 16) || 0 : 0;
  const hue = n % 360;
  const hue2 = (hue + 50 + ((n >>> 9) % 70)) % 360;
  const face = (
    <span
      className="avatar"
      aria-hidden
      style={{
        width: size,
        height: size,
        background: seed ? `linear-gradient(135deg, hsl(${hue} 85% 64%), hsl(${hue2} 80% 52%))` : "linear-gradient(135deg, #475066, #2b3446)",
      }}
    >
      {image && (
        // Arbitrary hosts from token metadata, so next/image's domain list doesn't apply.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" className="avatar-img" onError={() => setBroken(image)} />
      )}
      {children}
    </span>
  );
  return link && seed && ADDRESS.test(seed) ? (
    <Link href={profilePath(seed)} aria-label="Open profile" className="shrink-0 rounded-full">
      {face}
    </Link>
  ) : (
    face
  );
}
