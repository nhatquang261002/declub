import { isAddress } from "viem";
import type { AvatarView } from "@/lib/avatars";
import { profileKey, type Profile, type StoredProfile } from "@/lib/profiles";
import { readAvatars } from "@/lib/server/avatars";
import { clientId, getStore, withinLimit } from "@/lib/server/store";

const MAX_ADDRESSES = 50;

/**
 * GET /api/profiles?addresses=0x…,0x…
 * The shared profiles and avatars (ADR 0028) of up to 50 wallets, keyed by lowercase address.
 * Wallets whose owner hasn't shared one are left out, and so is everything but the provider and
 * handle. Public: it is what the owners chose to show. With no store configured the answer is
 * simply empty.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("addresses") ?? "";
  const addresses = [
    ...new Set(
      raw
        .split(",")
        .map((a) => a.trim().toLowerCase())
        .filter((a) => isAddress(a, { strict: false })),
    ),
  ].slice(0, MAX_ADDRESSES);

  const profiles: Record<string, Profile> = {};
  let avatars: Record<string, AvatarView> = {};
  const store = getStore();
  if (store && addresses.length > 0) {
    if (!(await withinLimit(store, "profiles", clientId(request), 240, 60))) {
      return Response.json({ error: "rate_limited", message: "Too many requests." }, { status: 429 });
    }
    try {
      const rows = await store.getMany<StoredProfile>(addresses.map(profileKey));
      rows.forEach((row, i) => {
        if (row) profiles[addresses[i]] = { provider: row.provider, handle: row.handle };
      });
    } catch (error) {
      // Profiles are cosmetic: a store outage shows plain addresses instead of failing the page.
      console.error("profile lookup failed:", error);
    }
    try {
      avatars = await readAvatars(store, addresses);
    } catch (error) {
      console.error("avatar lookup failed:", error);
    }
  }
  return Response.json({ profiles, avatars }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } });
}
