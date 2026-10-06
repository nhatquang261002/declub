import { isAddress } from "viem";
import { keptImage } from "@/lib/server/avatars";
import { clientId, getStore, withinLimit } from "@/lib/server/store";

/**
 * GET /api/avatars/[address]?v=…
 * The picture a wallet's owner uploaded as their avatar, or their NFT's inline art (ADR 0028).
 * Public. `v` is the version, so a new picture gets a new URL and each one can be cached for long.
 *
 * The bytes were checked against their type when stored. They are still served as an inert file:
 * an SVG opened on its own here can't run scripts or load anything.
 */
export async function GET(request: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!isAddress(address, { strict: false })) return new Response("Not found", { status: 404 });
  const store = getStore();
  if (!store) return new Response("Not found", { status: 404 });
  if (!(await withinLimit(store, "avatar-img", clientId(request), 600, 60))) return new Response("Too many requests", { status: 429 });

  const image = await keptImage(store, address);
  if (!image) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, s-maxage=30" } });

  const asked = new URL(request.url).searchParams.get("v");
  const current = asked === String(image.version);
  return new Response(Buffer.from(image.data, "base64"), {
    headers: {
      "Content-Type": image.type,
      // The URL names a version, so the current one never changes; any other is short-lived.
      "Cache-Control": current ? "public, max-age=31536000, immutable" : "public, max-age=60",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
