/** A round avatar whose colours come from the address, so a wallet looks the same everywhere. */
export function WalletAvatar({ seed, size = "1.9rem", children }: { seed?: string; size?: string; children?: React.ReactNode }) {
  const n = seed ? parseInt(seed.replace(/^0x/, "").slice(0, 8), 16) || 0 : 0;
  const hue = n % 360;
  const hue2 = (hue + 50 + ((n >>> 9) % 70)) % 360;
  return (
    <span
      className="avatar"
      aria-hidden
      style={{
        width: size,
        height: size,
        background: seed
          ? `linear-gradient(135deg, hsl(${hue} 85% 64%), hsl(${hue2} 80% 52%))`
          : "linear-gradient(135deg, #475066, #2b3446)",
      }}
    >
      {children}
    </span>
  );
}
