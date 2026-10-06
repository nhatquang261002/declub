import { getAddress, isAddress } from "viem";
import { avatarView, MAX_IMAGE_BYTES } from "@/lib/avatars";
import { linkedEthereumWallets } from "@/lib/profiles";
import { clearAvatar, ownedAvatar, setNftAvatar, setUploadAvatar, stillHeld, syncAvatar, type SetResult } from "@/lib/server/avatars";
import { fail, gateUser, json } from "@/lib/server/gate";

/**
 * The signed-in user's own avatar (ADR 0028). Every call needs their Privy access token. The
 * wallets it goes on, and the one that must hold an NFT, are read from Privy, never from the body.
 *
 *   GET     { enabled, avatar?, held? }     `held: false` when the NFT has left the wallet
 *   PUT     { nft: { collection, tokenId } } or { upload: "data:image/…;base64,…" }
 *   DELETE  remove it
 */

const REFUSALS: Record<Exclude<SetResult, { ok: true }>["reason"], [number, string]> = {
  no_wallet: [422, "Link a wallet first."],
  not_held: [403, "None of your linked wallets holds that NFT."],
  no_image: [422, "That NFT’s metadata has no picture this app can show. Pick another one."],
  bad_image: [422, "Use a PNG, JPEG, WebP or GIF image."],
};

export async function GET(request: Request) {
  const g = await gateUser(request, "avatar", 30);
  if (g instanceof Response) return g;
  const { store, user } = g;

  const wallets = linkedEthereumWallets(user.linked_accounts);
  // Linking or unlinking a wallet changes where the avatar shows; catch up here as well as in the webhook.
  await syncAvatar(store, user.id, wallets);
  const row = await ownedAvatar(store, user.id, wallets);
  if (!row || wallets.length === 0) return json({ enabled: true });
  return json({ enabled: true, avatar: avatarView(wallets[0], row), held: await stillHeld(row) });
}

export async function PUT(request: Request) {
  const g = await gateUser(request, "avatar", 20);
  if (g instanceof Response) return g;
  const { store, user } = g;

  const text = await request.text();
  if (text.length > MAX_IMAGE_BYTES * 2) return fail(413, "too_large", "That image is too big. Pick a smaller one.");
  let body: { nft?: { collection?: unknown; tokenId?: unknown }; upload?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "bad_request", "Pick an NFT or an image.");
  }

  const wallets = linkedEthereumWallets(user.linked_accounts);
  let result: SetResult;
  if (body.nft) {
    const { collection, tokenId } = body.nft;
    if (typeof collection !== "string" || !isAddress(collection, { strict: false }) || typeof tokenId !== "string" || !/^\d{1,78}$/.test(tokenId)) {
      return fail(400, "bad_request", "Pick an NFT.");
    }
    result = await setNftAvatar(store, user.id, wallets, getAddress(collection), BigInt(tokenId));
  } else if (typeof body.upload === "string") {
    result = await setUploadAvatar(store, user.id, wallets, body.upload);
  } else {
    return fail(400, "bad_request", "Pick an NFT or an image.");
  }

  if (!result.ok) {
    const [status, message] = REFUSALS[result.reason];
    return fail(status, result.reason, message);
  }
  return json({ enabled: true, avatar: result.avatar, held: true, wallets: wallets.map((w) => w.toLowerCase()) });
}

export async function DELETE(request: Request) {
  const g = await gateUser(request, "avatar", 20);
  if (g instanceof Response) return g;
  await clearAvatar(g.store, g.user.id);
  return json({ enabled: true, wallets: linkedEthereumWallets(g.user.linked_accounts).map((w) => w.toLowerCase()) });
}
