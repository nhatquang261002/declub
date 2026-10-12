import { CHAIN_ID } from "../config";
import { PACK_KINDS, PACK_MAX, PACK_NAME, packImageUrl, type PackEntry, type PackItem, type PackKind } from "../clubPack";
import { isStaff, roleOf } from "../clubRoles";
import type { AssetEntry, ClubEntry } from "../verifiedAssets";
import type { Actor } from "./board";
import { adminIds, appendLog, loadRoles } from "./clubState";
import { imagesOf, type ImageStore, type PostPicture } from "./postImages";
import type { Store } from "./store";

/**
 * A Club's own emoji and stickers (ADR 0057, docs/09-clubs.md): the Club's staff add them, members
 * type `:name:`. The list is one row per Club; each picture is an object in the same private store as
 * post pictures, named by its hash so replacing one never serves the old picture from a cache.
 */
export type PackDeps = {
  /** App admins' user ids; defaults to CLUB_ADMIN_USER_IDS. */
  admins?: ReadonlySet<string>;
  /** Epoch ms. */
  now?: () => number;
  /** Where the pictures are kept; object storage in production, `null` for none. */
  images?: ImageStore | null;
};

export const packKey = (token: string) => `declub:club-pack:${CHAIN_ID}:${token.toLowerCase()}`;
const objectKey = (token: string, entry: Pick<PackEntry, "name" | "hash">) =>
  `club-pack/${CHAIN_ID}/${token.toLowerCase()}/${entry.name}-${entry.hash.slice(2, 14)}`;

export async function loadPack(store: Store, token: string): Promise<PackEntry[]> {
  return (await store.get<PackEntry[]>(packKey(token))) ?? [];
}

/** The pack as readers see it: what to draw, and where to fetch it. Who added it stays on the server. */
export const packItems = (token: string, entries: readonly PackEntry[]): PackItem[] =>
  entries.map((e) => ({ name: e.name, kind: e.kind, url: packImageUrl(token, e) }));

async function isStaffOf(store: Store, token: string, userId: string, deps: PackDeps) {
  return isStaff(roleOf(await loadRoles(store, token), userId, (deps.admins ?? adminIds()).has(userId)));
}

const log = (store: Store, entry: AssetEntry, actor: Actor, action: string, target: string, detail?: string) =>
  appendLog(store, entry.address, { actor: actor.wallet, action, target, ...(detail ? { detail } : {}) });

export type PackRefusal = "archived" | "forbidden" | "bad_name" | "bad_pack_kind" | "bad_image" | "images_unavailable" | "name_taken" | "pack_full";

/**
 * Adds a picture to the Club's emoji or stickers, or replaces the one of that name. Staff only; a
 * Club that is archived takes no changes. `picture` is `parsePostImage`'s answer (`null` if it
 * wasn't acceptable), already held to the pack's size.
 */
export async function addToPack(
  store: Store,
  entry: ClubEntry,
  actor: Actor,
  input: { name: unknown; kind: unknown; picture: PostPicture | null | undefined },
  deps: PackDeps = {},
): Promise<{ ok: true; items: PackItem[]; replaced: boolean } | { ok: false; reason: PackRefusal }> {
  const token = entry.address.toLowerCase();
  if (entry.club === "archived") return { ok: false, reason: "archived" };
  if (!(await isStaffOf(store, token, actor.userId, deps))) return { ok: false, reason: "forbidden" };
  const { name, kind, picture } = input;
  if (typeof name !== "string" || !PACK_NAME.test(name)) return { ok: false, reason: "bad_name" };
  if (typeof kind !== "string" || !PACK_KINDS.includes(kind as PackKind)) return { ok: false, reason: "bad_pack_kind" };
  if (!picture) return { ok: false, reason: "bad_image" };
  const images = imagesOf(deps);
  if (!images) return { ok: false, reason: "images_unavailable" };

  const entries = await loadPack(store, token);
  const before = entries.find((e) => e.name === name);
  // A name is one thing in a Club: an emoji and a sticker can't share it.
  if (before && before.kind !== kind) return { ok: false, reason: "name_taken" };
  if (!before && entries.filter((e) => e.kind === kind).length >= PACK_MAX[kind as PackKind]) return { ok: false, reason: "pack_full" };

  const next: PackEntry = {
    name,
    kind: kind as PackKind,
    type: picture.type,
    size: picture.bytes.length,
    hash: picture.hash,
    at: deps.now?.() ?? Date.now(),
    by: actor.wallet,
  };
  // The picture first, so the list never names one that isn't there.
  try {
    await images.put(objectKey(token, next), picture.bytes, picture.type);
  } catch {
    return { ok: false, reason: "images_unavailable" };
  }
  const saved = [...entries.filter((e) => e.name !== name), next];
  await store.set(packKey(token), saved);
  // The old picture is unreachable now; a failed delete leaves an object nothing points at.
  if (before && before.hash !== next.hash) await images.del(objectKey(token, before)).catch(() => undefined);
  await log(store, entry, actor, "add_pack", name, `${kind}${before ? " (replaced)" : ""}`);
  return { ok: true, items: packItems(token, saved), replaced: !!before };
}

/** Takes one off the pack. Staff only; allowed in an archived Club, as removing is. */
export async function removeFromPack(
  store: Store,
  entry: AssetEntry,
  actor: Actor,
  name: unknown,
  deps: PackDeps = {},
): Promise<{ ok: true; items: PackItem[] } | { ok: false; reason: "forbidden" | "not_found" }> {
  const token = entry.address.toLowerCase();
  if (!(await isStaffOf(store, token, actor.userId, deps))) return { ok: false, reason: "forbidden" };
  const entries = await loadPack(store, token);
  const found = entries.find((e) => e.name === name);
  if (!found) return { ok: false, reason: "not_found" };
  const saved = entries.filter((e) => e !== found);
  await store.set(packKey(token), saved);
  await imagesOf(deps)
    ?.del(objectKey(token, found))
    .catch(() => undefined);
  await log(store, entry, actor, "remove_pack", found.name, found.kind);
  return { ok: true, items: packItems(token, saved) };
}

/** One picture's bytes. Public: a Club's pack is meant to be seen. */
export async function readPackImage(
  store: Store,
  entry: AssetEntry,
  name: string,
  deps: PackDeps = {},
): Promise<{ ok: true; bytes: Uint8Array; type: string } | { ok: false; reason: "not_found" | "images_unavailable" }> {
  const token = entry.address.toLowerCase();
  const found = (await loadPack(store, token)).find((e) => e.name === name);
  if (!found) return { ok: false, reason: "not_found" };
  const images = imagesOf(deps);
  if (!images) return { ok: false, reason: "images_unavailable" };
  try {
    const kept = await images.get(objectKey(token, found));
    return kept ? { ok: true, bytes: kept.bytes, type: found.type } : { ok: false, reason: "not_found" };
  } catch {
    return { ok: false, reason: "images_unavailable" };
  }
}

/** Deletes a Club's pack and its pictures, for a purge. */
export async function purgePack(store: Store, token: string, deps: Pick<PackDeps, "images"> = {}): Promise<number> {
  const entries = await loadPack(store, token);
  await imagesOf(deps)
    ?.del(...entries.map((e) => objectKey(token, e)))
    .catch(() => undefined);
  await store.del(packKey(token));
  return entries.length;
}
