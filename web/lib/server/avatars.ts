import { createPublicClient, getAddress, http, parseAbi, type Address, type PublicClient } from "viem";
import { chain } from "../chain";
import { IPFS_GATEWAY, RPC_URL } from "../config";
import {
  AVATAR_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  avatarImageKey,
  avatarKey,
  avatarView,
  avatarWalletsKey,
  type AvatarImageType,
  type AvatarView,
  type StoredAvatar,
  type StoredImage,
} from "../avatars";
import { readJson as readTokenJson } from "./collectionScan";
import type { Store } from "./store";

/**
 * Account avatars on the server (ADR 0028). The user's wallets always come from Privy, never from
 * the request, and an NFT counts only if the chain says one of those wallets owns it. Its art is
 * read here from the token's own metadata, so nobody can pass off another picture as their NFT.
 */

/** What the chain is asked. Kept small so tests can answer it from a table. */
export type AvatarChain = {
  /** `ownerOf` for each token, `null` where it reverts (burned, never minted). Throws when the RPC fails. */
  owners(tokens: readonly { collection: Address; tokenId: bigint }[]): Promise<(Address | null)[]>;
  /** `null` when the contract doesn't answer. */
  tokenURI(collection: Address, tokenId: bigint): Promise<string | null>;
};

export type AvatarDeps = { chain?: AvatarChain; readJson?: (uri: string) => Promise<unknown> };

const abi = parseAbi(["function ownerOf(uint256) view returns (address)", "function tokenURI(uint256) view returns (string)"]);

let cachedClient: PublicClient | undefined;
const rpc = () => (cachedClient ??= createPublicClient({ chain, transport: http(RPC_URL), batch: { multicall: true } }) as PublicClient);

export const viemAvatarChain: AvatarChain = {
  async owners(tokens) {
    if (tokens.length === 0) return [];
    const results = await rpc().multicall({
      contracts: tokens.map((t) => ({ address: t.collection, abi, functionName: "ownerOf", args: [t.tokenId] }) as const),
      allowFailure: true,
    });
    return results.map((r) => (r.status === "success" ? (r.result as Address) : null));
  },
  async tokenURI(collection, tokenId) {
    try {
      return await rpc().readContract({ address: collection, abi, functionName: "tokenURI", args: [tokenId] });
    } catch {
      return null;
    }
  },
};

// ─────────────────────────────────────────────────────────────── Pictures

const MAX_URL = 2048;

const startsWith = (bytes: Uint8Array, ...head: number[]) => head.every((b, i) => bytes[i] === b);
const ascii = (bytes: Uint8Array, from: number, text: string) => Buffer.from(bytes.subarray(from, from + text.length)).toString("latin1") === text;

/** Whether the bytes are what the type says, so a stored picture can't be some other kind of file. */
function looksLike(type: AvatarImageType, bytes: Uint8Array): boolean {
  switch (type) {
    case "image/png": return startsWith(bytes, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg": return startsWith(bytes, 0xff, 0xd8, 0xff);
    case "image/webp": return ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP");
    case "image/gif": return ascii(bytes, 0, "GIF8");
    case "image/svg+xml": return /<svg[\s>]/i.test(Buffer.from(bytes).toString("utf8"));
  }
}

/**
 * A `data:image/…` URL as a picture to keep, or `null` when it isn't one of the allowed types, is
 * too big, or its bytes aren't what it claims. SVG is allowed only for NFT art (on-chain
 * collections draw in SVG); uploads are raster images the browser made.
 */
export function parseImage(url: string, allowSvg: boolean): Omit<StoredImage, "version"> | null {
  // Parameters (`;charset=utf-8`, `;utf8`) are skipped; `;base64` says how the body is written.
  const match = /^data:(image\/[a-z+]+)((?:;(?!base64,)[a-z0-9-]+(?:=[^;,]*)?)*)(;base64)?,(.*)$/is.exec(url);
  if (!match) return null;
  const type = match[1].toLowerCase() as AvatarImageType;
  if (!AVATAR_IMAGE_TYPES.includes(type) || (type === "image/svg+xml" && !allowSvg)) return null;
  // A base64 body is at most 4/3 of the bytes; anything far past the cap isn't decoded at all.
  if (match[4].length > MAX_IMAGE_BYTES * 3) return null;
  let bytes: Uint8Array;
  try {
    bytes = match[3] ? Buffer.from(match[4], "base64") : Buffer.from(decodeURIComponent(match[4]), "utf8");
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || !looksLike(type, bytes)) return null;
  return { type, data: Buffer.from(bytes).toString("base64") };
}

type NftArt = { image: string } | { kept: Omit<StoredImage, "version"> };

/** The token's art from its metadata: an https URL to link to, or an inline picture to keep. */
async function nftArt(collection: Address, tokenId: bigint, deps: AvatarDeps): Promise<NftArt | null> {
  const uri = await (deps.chain ?? viemAvatarChain).tokenURI(collection, tokenId);
  if (!uri) return null;
  let json: unknown;
  try {
    json = await (deps.readJson ?? readTokenJson)(uri);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const { image, image_url } = json as { image?: unknown; image_url?: unknown };
  const raw = typeof image === "string" && image ? image : typeof image_url === "string" ? image_url : "";
  if (raw.startsWith("data:")) {
    const kept = parseImage(raw, true);
    return kept ? { kept } : null;
  }
  const url = raw.startsWith("ipfs://") ? IPFS_GATEWAY + raw.slice("ipfs://".length).replace(/^ipfs\//, "") : raw;
  // https only: the page is served over https, and the browser fetches it, not this server.
  return /^https:\/\/[^\s"'<>]+$/i.test(url) && url.length <= MAX_URL ? { image: url } : null;
}

// ─────────────────────────────────────────────────────────────── Rows

/** The avatar this user has set, read from whichever of their wallets still has its row. */
export async function ownedAvatar(store: Store, userId: string, wallets: string[]): Promise<StoredAvatar | null> {
  const addresses = [...new Set([...(await store.members(avatarWalletsKey(userId))), ...wallets.map((w) => w.toLowerCase())])];
  const rows = await store.getMany<StoredAvatar>(addresses.map(avatarKey));
  return rows.find((row) => row?.userId === userId) ?? null;
}

/** Writes `row` for each of `wallets` and removes it from wallets the user wrote it for before. */
async function writeRows(store: Store, userId: string, wallets: string[], row: StoredAvatar | null) {
  const now = new Set(row ? wallets.map((w) => w.toLowerCase()) : []);
  const before = await store.members(avatarWalletsKey(userId));
  const gone = before.filter((address) => !now.has(address));
  // Only rows this user wrote are removed: a wallet that moved to another user keeps theirs.
  const goneRows = await store.getMany<StoredAvatar>(gone.map(avatarKey));
  await store.del(...gone.filter((_, i) => goneRows[i]?.userId === userId).map(avatarKey));
  if (row) await Promise.all([...now].map((address) => store.set(avatarKey(address), row)));
  await store.setMembers(avatarWalletsKey(userId), [...now]);
}

export type SetResult = { ok: true; avatar: AvatarView } | { ok: false; reason: "no_wallet" | "not_held" | "no_image" | "bad_image" };

/** Makes one of the user's NFTs their avatar. The chain must say one of `wallets` owns it now. */
export async function setNftAvatar(
  store: Store,
  userId: string,
  wallets: Address[],
  collection: Address,
  tokenId: bigint,
  deps: AvatarDeps = {},
): Promise<SetResult> {
  if (wallets.length === 0) return { ok: false, reason: "no_wallet" };
  const [owner] = await (deps.chain ?? viemAvatarChain).owners([{ collection, tokenId }]);
  const holder = owner ? wallets.find((w) => w.toLowerCase() === owner.toLowerCase()) : undefined;
  if (!holder) return { ok: false, reason: "not_held" };

  const art = await nftArt(collection, tokenId, deps);
  if (!art) return { ok: false, reason: "no_image" };
  const version = Date.now();
  const row: StoredAvatar = {
    userId,
    version,
    nft: { collection: getAddress(collection), tokenId: tokenId.toString(), holder: holder.toLowerCase() },
    ...("image" in art ? { image: art.image } : {}),
  };
  if ("kept" in art) await store.set(avatarImageKey(userId), { ...art.kept, version } satisfies StoredImage);
  else await store.del(avatarImageKey(userId));
  await writeRows(store, userId, wallets, row);
  return { ok: true, avatar: avatarView(wallets[0], row) };
}

/** Makes an uploaded picture (a `data:` URL the browser has already cropped and shrunk) the avatar. */
export async function setUploadAvatar(store: Store, userId: string, wallets: Address[], dataUrl: string): Promise<SetResult> {
  if (wallets.length === 0) return { ok: false, reason: "no_wallet" };
  const image = parseImage(dataUrl, false);
  if (!image) return { ok: false, reason: "bad_image" };
  const version = Date.now();
  await store.set(avatarImageKey(userId), { ...image, version } satisfies StoredImage);
  const row: StoredAvatar = { userId, version };
  await writeRows(store, userId, wallets, row);
  return { ok: true, avatar: avatarView(wallets[0], row) };
}

export async function clearAvatar(store: Store, userId: string) {
  await writeRows(store, userId, [], null);
  await store.del(avatarImageKey(userId));
}

/**
 * Brings the avatar in line with the user's linked wallets: a new wallet gets it, an unlinked one
 * loses it. An NFT avatar goes away entirely when the wallet holding the NFT is unlinked, since it
 * would then show for a token the user no longer holds. Idempotent, like the profile sync.
 */
export async function syncAvatar(store: Store, userId: string, wallets: Address[]) {
  const row = await ownedAvatar(store, userId, wallets);
  const keep = row && (!row.nft || wallets.some((w) => w.toLowerCase() === row.nft!.holder));
  if (!keep) {
    if (row || (await store.countMembers(avatarWalletsKey(userId))) > 0) await clearAvatar(store, userId);
    return;
  }
  await writeRows(store, userId, wallets, row);
}

/** Whether an NFT avatar's holder still owns the token; `null` when the chain couldn't be asked. */
export async function stillHeld(row: StoredAvatar, deps: AvatarDeps = {}): Promise<boolean | null> {
  if (!row.nft) return true;
  try {
    const [owner] = await (deps.chain ?? viemAvatarChain).owners([{ collection: row.nft.collection, tokenId: BigInt(row.nft.tokenId) }]);
    return owner?.toLowerCase() === row.nft.holder;
  } catch {
    return null;
  }
}

/**
 * The avatars of `addresses` (lowercase), as others see them. An NFT avatar is left out once its
 * holder no longer owns the token; if the chain can't be asked they are shown, since an avatar is
 * cosmetic and the next read checks again.
 */
export async function readAvatars(store: Store, addresses: string[], deps: AvatarDeps = {}): Promise<Record<string, AvatarView>> {
  const rows = await store.getMany<StoredAvatar>(addresses.map(avatarKey));
  const nfts = rows.flatMap((row, i) => (row?.nft ? [i] : []));
  let owners: (Address | null)[] | null = null;
  if (nfts.length > 0) {
    try {
      owners = await (deps.chain ?? viemAvatarChain).owners(
        nfts.map((i) => ({ collection: rows[i]!.nft!.collection, tokenId: BigInt(rows[i]!.nft!.tokenId) })),
      );
    } catch {
      owners = null;
    }
  }
  const sold = new Set(owners ? nfts.filter((i, n) => owners![n]?.toLowerCase() !== rows[i]!.nft!.holder) : []);
  const out: Record<string, AvatarView> = {};
  rows.forEach((row, i) => {
    if (row && !sold.has(i)) out[addresses[i]] = avatarView(addresses[i], row);
  });
  return out;
}

/** The kept picture shown for a wallet, for `/api/avatars/[address]`. */
export async function keptImage(store: Store, address: string): Promise<StoredImage | null> {
  const row = await store.get<StoredAvatar>(avatarKey(address));
  if (!row || row.image) return null;
  return store.get<StoredImage>(avatarImageKey(row.userId));
}
