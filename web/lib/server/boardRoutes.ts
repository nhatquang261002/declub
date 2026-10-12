import { isAddress } from "viem";
import { linkedEthereumWallets } from "../profiles";
import type { Registry } from "../verifiedAssets";
import {
  banUser,
  claimOwner,
  createSignedPost,
  createSignedReply,
  exportReplies,
  readPostImage,
  listReplies,
  deletePost,
  exportPosts,
  hidePost,
  listBans,
  listPosts,
  ownershipCheck,
  pinPost,
  purgeClub,
  listReported,
  reportPost,
  roleIn,
  setRole,
  unbanUser,
  likePost,
  updateProfile,
  type Actor,
  type Deps as BoardDeps,
} from "./board";
import { adminIds, loadProfile, loadRoles, readLog } from "./clubState";
import { signalsOf, startXLink, unlinkX, verifyXLink } from "./xPosts";
import { signalsHint } from "../xPosts";
import { POST_COOLDOWN_SEC, type ClubProfile } from "../clubPosts";
import type { ClubEntry } from "../verifiedAssets";
import { fail, gateUser, json, type UserGate } from "./gate";
import { getMember } from "./members";
import { coinRule } from "../members";
import { gatedClub, publicRead, type Ctx } from "./memberRoutes";
import { authenticate } from "./privy";
import type { Store } from "./store";
import { isStaff } from "../clubRoles";
import { lensOf } from "../lenses";
import { parsePostMessage, parseReplyMessage, socialDomain, SOCIAL_TYPES } from "../social";
import { DEFAULT_STICKERS, PACK_EDGE, PACK_EMOJI_MAX, PACK_IMAGE_MAX_BYTES, PACK_STICKER_MAX } from "../clubPack";
import { addToPack, loadPack, packItems, readPackImage, removeFromPack } from "./clubPack";
import { parsePostImage } from "./postImages";
import { clubRulesView, listRewardBans, setRewardBan, updateRules } from "./rewardSettings";
import {
  cancelChallenge,
  createChallenge,
  enterChallenge,
  getChallenge,
  listChallenges,
  pickWinners,
  sendPrize,
  withdrawEntry,
  type ChallengeDeps,
} from "./challenges";

/**
 * The board and staff routes, built over a registry like the other Club routes so tests can use a
 * list of their own. Writes need the caller's Privy access token; reads are public, and a reader
 * who sends a token also sees their own hidden posts (and, as staff, every hidden one).
 */
export type RouteDeps = BoardDeps &
  Pick<ChallengeDeps, "blocks" | "prizeChain"> & {
    gate?: (request: Request, name: string, limit: number) => Promise<UserGate>;
    /** Who is reading, if they said: Privy in production, a stand-in in tests. */
    viewer?: (request: Request) => Promise<{ id: string } | null>;
  };

type ItemCtx = { params: Promise<{ token: string; id: string }> };

/** Every refusal reason, and what the caller is told. */
const REFUSALS: Record<string, [number, string]> = {
  archived: [409, "This Club is archived: it stays readable, but it isn’t taking changes."],
  not_member: [403, "Join the Club first."],
  banned: [403, "You can’t do that in this Club."],
  no_profile: [403, "Turn on “Show my X or Discord handle” on your Profile page first (with X or Discord linked), so people can see who is posting."],
  holders_only: [403, "The Owner has limited posting to Holders."],
  bad_kind: [400, "A post is a note or a “looking for”."],
  empty: [400, "Write something first."],
  too_long: [400, "Posts are at most 280 characters."],
  bad_image: [422, "Use a PNG, JPEG or WebP picture under 1 MB. The app shrinks larger ones for you."],
  bad_name: [400, "A name is 2 to 24 lowercase letters, digits or _, with at least one letter."],
  bad_pack_kind: [400, "Add it as an emoji or a sticker."],
  name_taken: [409, "That name is already used for the other kind. Pick another."],
  pack_full: [409, `A Club can have ${PACK_EMOJI_MAX} emoji and ${PACK_STICKER_MAX} stickers. Remove one first.`],
  images_unavailable: [503, "Pictures aren’t available right now. Post without one, or try again later."],
  image_limit: [429, "You’ve posted as many pictures as you can today. Try again tomorrow."],
  bad_link: [400, "A “looking for” post links a deal id or a signed-swap hash; a note links an X post."],
  link_not_found: [404, "That deal or signed swap wasn’t found."],
  link_mismatch: [422, "That deal or signed swap doesn’t involve this Club’s asset."],
  link_unavailable: [503, "Couldn’t check that link right now. Try again."],
  x_not_found: [404, "That X post wasn’t found, or it isn’t public."],
  x_unavailable: [503, "Couldn’t reach X to read that post. Try again."],
  bad_handle: [400, "Give an X handle: up to 15 letters, digits or _."],
  already_linked: [409, "That X account is already linked."],
  too_many_accounts: [409, "A Club links at most 3 X accounts."],
  xlink_expired: [409, "Start again: that code has expired, or none was asked for this account."],
  xlink_mismatch: [422, "That post isn’t from that account, or it doesn’t have the code."],
  xlink_unavailable: [503, "Couldn’t reach X to read that post. Try again."],
  cooldown: [429, `Wait ${POST_COOLDOWN_SEC} seconds between posts.`],
  rate_limited: [429, "You’ve reached the limit for now. Try again later."],
  unsigned: [400, "Sign the post with your wallet first."],
  wrong_club: [400, "That post was signed for another Club."],
  not_clean: [400, "The signed text or link isn’t in the form the Board stores. Sign it again."],
  stale: [400, "That signature is too old, or your clock is off. Sign it again."],
  bad_signature: [401, "The signature doesn’t match your Club wallet. Sign with the wallet the Members list shows for you."],
  wrong_signer: [409, "That signed post belongs to someone else."],
  not_found: [404, "Not found."],
  forbidden: [403, "You can’t do that."],
  own_post: [409, "You can’t report your own post."],
  own_like: [409, "You can’t like your own post."],
  too_many_pinned: [409, "At most 3 posts can be pinned."],
  hidden: [409, "A hidden post can’t be pinned or liked."],
  too_many_open: [409, "A Club can have 3 challenges open at once."],
  owner_entry: [403, "The Owner sets the challenge and can’t enter it."],
  bad_post: [422, "Enter a post of your own, posted while the challenge is open, that isn’t hidden or a reply."],
  not_x: [422, "An entry is your own X post: post it on X, then share its link."],
  x_not_own: [422, "That X post isn’t from the X account linked to your profile. Enter one you posted yourself."],
  x_too_old: [422, "That X post was made before the challenge started. Post a new one for it."],
  already_entered: [409, "That post is already an entry in another challenge."],
  full: [409, "This challenge has as many entries as it can take."],
  closed: [409, "This challenge has ended."],
  not_judging: [409, "This challenge isn’t waiting for the Owner’s pick."],
  no_entry: [404, "You haven’t entered this challenge."],
  drawing: [409, "This raffle’s draw is already committed to a block, so it can’t be called off."],
  reward_banned: [403, "You’re banned from this Club’s rewards, so you can’t enter its challenges."],
  busy: [409, "That is being settled right now. Try again in a moment."],
  challenge_conflict: [409, "You and this member are in the same challenge, so the Owner or another Moderator has to do that."],
  voting_closed: [409, "This post is an entry in a challenge that has ended, so its likes are locked."],
  prize_overdue: [409, "A winner of an earlier challenge here is still waiting on their prize. Send it and mark it sent before offering another."],
  no_prize: [409, "That winner isn’t owed a prize from this challenge."],
  prize_sent: [409, "That prize is already marked as sent."],
  tx_used: [409, "That transaction has already paid a prize."],
  tx_not_found: [404, "That transaction wasn’t found on chain yet. Wait for it to be mined, then try again."],
  tx_failed: [422, "That transaction failed on chain, so it sent nothing."],
  tx_too_early: [422, "That transaction was made before the challenge ended. Send the prize after it settles."],
  wrong_asset: [422, "That transaction doesn’t move the prize’s NFT or token."],
  wrong_recipient: [422, "That transaction doesn’t send the prize to any wallet the winner has linked."],
  too_little: [422, "That transaction sends less than the winner is owed."],
  chain_unavailable: [503, "Couldn’t read the chain right now. Try again."],
  thread_full: [409, "This post has as many replies as it can take."],
  too_many_moderators: [409, "A Club has at most 10 Moderators."],
  already_owner: [409, "They are already the Owner."],
  no_change: [409, "Nothing to change."],
  no_owner: [422, "This collection’s contract doesn’t name an owner, so there is nothing to claim through. Ask an admin."],
  not_owner: [403, "None of your linked wallets is this collection’s owner."],
  has_owner: [409, "This Club already has an Owner. Ask an admin."],
  invalid: [400, "That isn’t valid."],
  not_hidden: [409, "Only a Club that is hidden from the list can be purged."],
};

const refuse = (reason: string, message?: string) => {
  const [status, text] = REFUSALS[reason] ?? [400, "That isn’t allowed."];
  return fail(status, reason, message ?? text);
};

const bodyOf = async (request: Request): Promise<Record<string, unknown>> => {
  const body: unknown = await request.json().catch(() => null);
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
};

/** A user's id and the wallet to name them by in the log: their Club wallet, else their first linked one. */
async function actorOf(store: Store, token: string, user: { id: string; linked_accounts: unknown }): Promise<Actor> {
  const row = await getMember(store, token, user.id);
  const wallets = linkedEthereumWallets(user.linked_accounts as Parameters<typeof linkedEthereumWallets>[0]);
  return { userId: user.id, wallet: row?.displayWallet ?? wallets[0]?.toLowerCase() ?? "unknown" };
}

/** The common front of a write: the Club exists, the caller is signed in, and who they are. */
async function front(registry: Registry, ctx: Ctx, request: Request, deps: RouteDeps, name: string, limit = 30) {
  const f = await gatedClub(registry, ctx, request, deps, name, limit);
  if (f instanceof Response) return f;
  return { ...f, actor: await actorOf(f.store, f.entry.address, f.user) };
}

export async function softViewer(request: Request, deps: Pick<RouteDeps, "viewer">): Promise<{ id: string } | null> {
  if (!request.headers.get("authorization")) return null;
  return deps.viewer ? deps.viewer(request) : authenticate(request);
}

/** GET (public) and POST (members) /api/clubs/[token]/posts. */
export function postsHandlers(registry: Registry, deps: RouteDeps = {}) {
  return {
    async GET(request: Request, ctx: Ctx) {
      const read = await publicRead(registry, ctx, request, { enabled: false, posts: [], role: null });
      if (read instanceof Response) return read;
      const { entry, store } = read;

      const viewer = await softViewer(request, deps);
      const url = new URL(request.url);
      const lens = lensOf(url.searchParams.get("lens")).id;
      const as = url.searchParams.get("as") ?? undefined;
      // Without `limit` the whole board comes back; with it, one page of it.
      const limit = Number(url.searchParams.get("limit"));
      const offset = Number(url.searchParams.get("offset"));
      const page = Number.isInteger(limit) && limit > 0 ? { limit: Math.min(limit, 100), offset: Number.isInteger(offset) && offset > 0 ? offset : 0 } : {};
      const { posts, role, total } = await listPosts(
        store,
        entry,
        { userId: viewer?.id, lens, as: as && isAddress(as, { strict: false }) ? as : undefined, ...page },
        deps,
      );
      // Anonymous readers share one cached answer; a signed-in reader's depends on who they are.
      const cache = viewer ? "private, no-store" : "public, s-maxage=15, stale-while-revalidate=60";
      return Response.json({ enabled: true, posts, role, total }, { headers: { "Cache-Control": cache } });
    },

    async POST(request: Request, ctx: Ctx) {
      const f = await front(registry, ctx, request, deps, "club-post");
      if (f instanceof Response) return f;
      const body = await bodyOf(request);
      // Every post is signed by its author's Club wallet (ADR 0023), so it can be exported and checked.
      // A picture comes as a data URL beside the message, which signs its SHA-256; `null` is one that isn't acceptable.
      const picture = body.image === undefined ? undefined : parsePostImage(body.image);
      const result = await createSignedPost(f.store, f.entry, f.user.id, { message: parsePostMessage(body.message), signature: body.signature, picture }, deps);
      // `xShare` tells the author whether their X post counted, and if not, why.
      return result.ok ? json({ enabled: true, post: result.post, ...(result.xShare ? { xShare: result.xShare } : {}) }, 201) : refuse(result.reason);
    },
  };
}

/**
 * GET /api/clubs/[token]/posts/[id]/image: a post's picture (ADR 0056). Public for a post that isn't
 * hidden; for a hidden one only its author and staff get it, and send their token.
 */
export function postImageHandler(registry: Registry, deps: RouteDeps = {}) {
  return async function GET(request: Request, ctx: ItemCtx) {
    const read = await publicRead(registry, ctx, request, { enabled: false });
    if (read instanceof Response) return read;
    const { entry, store } = read;
    const viewer = await softViewer(request, deps);
    const result = await readPostImage(store, entry, (await ctx.params).id, { userId: viewer?.id }, deps);
    if (!result.ok) return refuse(result.reason, result.reason === "not_found" ? "Not found." : undefined);
    // Hiding a post can't recall a cached copy, so a public one is kept only briefly.
    return pictureResponse(result.bytes, result.type, result.hidden || viewer ? "private, no-store" : "public, max-age=300, s-maxage=300");
  };
}

/** A stored picture as a response. The bytes were checked as a picture, but this must never run as a page. */
const pictureResponse = (bytes: Uint8Array, type: string, cache: string) =>
  new Response(bytes as BodyInit, {
    headers: { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": cache },
  });

type PackCtx = { params: Promise<{ token: string; name: string }> };

/**
 * A Club's own emoji and stickers (ADR 0057). GET (public) lists them, with the built-in stickers and the limits; PUT (staff)
 * adds one or replaces the one of that name, `{ name, kind: "emoji" | "sticker", image }` with a
 * PNG, JPEG or WebP `data:` URL under 256 KB; DELETE (staff) removes `{ name }`.
 */
export function packHandlers(registry: Registry, deps: RouteDeps = {}) {
  return {
    async GET(request: Request, ctx: Ctx) {
      const read = await publicRead(registry, ctx, request, { enabled: false, pack: [] });
      if (read instanceof Response) return read;
      const { entry, store } = read;
      return Response.json(
        {
          enabled: true,
          pack: packItems(entry.address, await loadPack(store, entry.address)),
          // Every Club has these too, unless its own pack has the same name.
          builtin: DEFAULT_STICKERS,
          limits: { emoji: PACK_EMOJI_MAX, sticker: PACK_STICKER_MAX, bytes: PACK_IMAGE_MAX_BYTES, edge: PACK_EDGE },
        },
        { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
      );
    },

    async PUT(request: Request, ctx: Ctx) {
      const f = await front(registry, ctx, request, deps, "club-mod");
      if (f instanceof Response) return f;
      const body = await bodyOf(request);
      const picture = parsePostImage(body.image, PACK_IMAGE_MAX_BYTES);
      const result = await addToPack(f.store, f.entry, f.actor, { name: body.name, kind: body.kind, picture }, deps);
      if (result.ok) return json({ enabled: true, pack: result.items, replaced: result.replaced });
      return result.reason === "bad_image"
        ? refuse("bad_image", "Use a PNG, JPEG or WebP picture under 256 KB. The app shrinks larger ones for you.")
        : refuse(result.reason);
    },

    async DELETE(request: Request, ctx: Ctx) {
      const f = await front(registry, ctx, request, deps, "club-mod");
      if (f instanceof Response) return f;
      const body = await bodyOf(request);
      const result = await removeFromPack(f.store, f.entry, f.actor, body.name, deps);
      return result.ok ? json({ enabled: true, pack: result.items }) : refuse(result.reason);
    },
  };
}

/** GET /api/clubs/[token]/pack/[name]: one emoji or sticker's picture. Public. */
export function packImageHandler(registry: Registry, deps: RouteDeps = {}) {
  return async function GET(request: Request, ctx: PackCtx) {
    const read = await publicRead(registry, ctx, request, { enabled: false });
    if (read instanceof Response) return read;
    const result = await readPackImage(read.store, read.entry, (await ctx.params).name, deps);
    if (!result.ok) return refuse(result.reason, result.reason === "not_found" ? "Not found." : undefined);
    return pictureResponse(result.bytes, result.type, "public, max-age=300, s-maxage=300");
  };
}

/** GET (public) and POST (members) /api/clubs/[token]/posts/[id]/replies (ADR 0032). */
export function repliesHandlers(registry: Registry, deps: RouteDeps = {}) {
  return {
    async GET(request: Request, ctx: ItemCtx) {
      const read = await publicRead(registry, ctx, request, { enabled: false, replies: [] });
      if (read instanceof Response) return read;
      const { entry, store } = read;
      const viewer = await softViewer(request, deps);
      const result = await listReplies(store, entry, (await ctx.params).id, { userId: viewer?.id }, deps);
      if (!result.ok) return refuse(result.reason);
      const cache = viewer ? "private, no-store" : "public, s-maxage=15, stale-while-revalidate=60";
      return Response.json({ enabled: true, replies: result.replies }, { headers: { "Cache-Control": cache } });
    },

    async POST(request: Request, ctx: ItemCtx) {
      const f = await front(registry, ctx, request, deps, "club-reply");
      if (f instanceof Response) return f;
      const body = await bodyOf(request);
      const result = await createSignedReply(
        f.store,
        f.entry,
        f.user.id,
        (await ctx.params).id,
        { message: parseReplyMessage(body.message), signature: body.signature },
        deps,
      );
      if (result.ok) return json({ enabled: true, post: result.post }, 201);
      if (result.reason === "hidden") return refuse("hidden", "A hidden post can’t take replies.");
      if (result.reason === "not_found") return refuse("not_found", "That post wasn’t found, or it’s a reply: replies go under the post.");
      return refuse(result.reason);
    },
  };
}

/**
 * GET /api/clubs/[token]/feed: every signed post on the Club's Board, newest first, as the exact
 * EIP-712 message and signature, with the typed-data domain to check them against. Public, so any
 * app can carry a Club's conversation or rank it its own way. Posts hidden by moderation are left out.
 */
export function feedHandler(registry: Registry) {
  return async function GET(request: Request, ctx: Ctx) {
    const read = await publicRead(registry, ctx, request, { enabled: false, posts: [] });
    if (read instanceof Response) return read;
    const { entry, store } = read;
    const [posts, replies] = await Promise.all([exportPosts(store, entry), exportReplies(store, entry)]);
    return Response.json(
      {
        enabled: true,
        club: entry.address,
        domain: socialDomain(),
        types: { Post: SOCIAL_TYPES.Post, ImagePost: SOCIAL_TYPES.ImagePost, Reply: SOCIAL_TYPES.Reply },
        posts,
        replies,
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  };
}

/** DELETE /api/clubs/[token]/posts/[id]: the author, or staff who may act on the author. */
export function deletePostHandler(registry: Registry, deps: RouteDeps = {}) {
  return async function DELETE(request: Request, ctx: ItemCtx) {
    const f = await front(registry, ctx, request, deps, "club-post-edit");
    if (f instanceof Response) return f;
    const result = await deletePost(f.store, f.entry, f.actor, (await ctx.params).id, deps);
    return result.ok ? json({ enabled: true }) : refuse(result.reason);
  };
}

/** POST /api/clubs/[token]/posts/[id]/report */
export function reportHandler(registry: Registry, deps: RouteDeps = {}) {
  return async function POST(request: Request, ctx: ItemCtx) {
    const f = await front(registry, ctx, request, deps, "club-report", 30);
    if (f instanceof Response) return f;
    const result = await reportPost(f.store, f.entry, f.user.id, (await ctx.params).id, deps);
    return result.ok ? json({ enabled: true, hidden: result.hidden }) : refuse(result.reason);
  };
}

/** GET /api/clubs/[token]/reported: the reported posts and replies, for the Manage tab. Staff only. */
export function reportedHandler(registry: Registry, deps: RouteDeps = {}) {
  return async function GET(request: Request, ctx: Ctx) {
    const f = await front(registry, ctx, request, deps, "club-mod");
    if (f instanceof Response) return f;
    const reported = await listReported(f.store, f.entry, f.user.id, deps);
    return reported ? json({ enabled: true, reported }) : refuse("forbidden");
  };
}

/** POST (like) and DELETE (take it back) /api/clubs/[token]/posts/[id]/like */
export function likeHandlers(registry: Registry, deps: RouteDeps = {}) {
  const act = (like: boolean) =>
    async function (request: Request, ctx: ItemCtx) {
      const f = await front(registry, ctx, request, deps, "club-like", 240);
      if (f instanceof Response) return f;
      const result = await likePost(f.store, f.entry, f.user.id, (await ctx.params).id, like, deps);
      return result.ok ? json({ enabled: true, likes: result.likes }) : refuse(result.reason);
    };
  return { POST: act(true), DELETE: act(false) };
}

/** A staff POST that sets one yes/no flag on a post: `{ [key]: boolean }`. */
const flagHandler = (registry: Registry, deps: RouteDeps, key: "hidden" | "pinned", act: typeof hidePost) =>
  async function POST(request: Request, ctx: ItemCtx) {
    const f = await front(registry, ctx, request, deps, "club-mod");
    if (f instanceof Response) return f;
    const body = await bodyOf(request);
    const on = body[key];
    if (typeof on !== "boolean") return refuse("invalid", `Send { ${key}: true } or { ${key}: false }.`);
    const result = await act(f.store, f.entry, f.actor, (await ctx.params).id, on, deps);
    return result.ok ? json({ enabled: true }) : refuse(result.reason);
  };

/** POST /api/clubs/[token]/posts/[id]/hide  { hidden: boolean } */
export const hideHandler = (registry: Registry, deps: RouteDeps = {}) => flagHandler(registry, deps, "hidden", hidePost);

/** POST /api/clubs/[token]/posts/[id]/pin  { pinned: boolean } */
export const pinHandler = (registry: Registry, deps: RouteDeps = {}) => flagHandler(registry, deps, "pinned", pinPost);

/** GET (staff), POST and DELETE /api/clubs/[token]/bans. */
export function bansHandlers(registry: Registry, deps: RouteDeps = {}) {
  return {
    async GET(request: Request, ctx: Ctx) {
      const f = await front(registry, ctx, request, deps, "club-mod");
      if (f instanceof Response) return f;
      const bans = await listBans(f.store, f.entry, f.user.id, deps);
      return bans ? json({ enabled: true, ...bans }) : refuse("forbidden");
    },
    async POST(request: Request, ctx: Ctx) {
      const f = await front(registry, ctx, request, deps, "club-mod");
      if (f instanceof Response) return f;
      const body = await bodyOf(request);
      const result = await banUser(f.store, f.entry, f.actor, { wallet: body.wallet, post: body.post }, body.everywhere === true, deps);
      return result.ok ? json({ enabled: true, wallet: result.wallet }) : refuse(result.reason);
    },
    async DELETE(request: Request, ctx: Ctx) {
      const f = await front(registry, ctx, request, deps, "club-mod");
      if (f instanceof Response) return f;
      const body = await bodyOf(request);
      if (typeof body.wallet !== "string") return refuse("invalid", "Say which wallet to unban.");
      const result = await unbanUser(f.store, f.entry, f.actor, body.wallet, body.everywhere === true, deps);
      return result.ok ? json({ enabled: true }) : refuse(result.reason);
    },
  };
}

/** POST /api/clubs/[token]/claim: become Owner by holding the contract's `owner()` wallet. */
export function claimHandler(registry: Registry, deps: RouteDeps = {}) {
  return async function POST(request: Request, ctx: Ctx) {
    const f = await front(registry, ctx, request, deps, "club-claim", 10);
    if (f instanceof Response) return f;
    const wallets = linkedEthereumWallets(f.user.linked_accounts);
    const result = await claimOwner(f.store, f.entry, f.actor, wallets, deps);
    return result.ok ? json({ enabled: true, role: "owner" }) : refuse(result.reason);
  };
}

/** PUT /api/clubs/[token]/roles  { wallet, role: "owner" | "moderator" | null } */
export function rolesHandler(registry: Registry, deps: RouteDeps = {}) {
  return async function PUT(request: Request, ctx: Ctx) {
    const f = await front(registry, ctx, request, deps, "club-mod");
    if (f instanceof Response) return f;
    const body = await bodyOf(request);
    const role = body.role;
    if (typeof body.wallet !== "string" || (role !== null && role !== "owner" && role !== "moderator")) {
      return refuse("invalid", "Send { wallet, role } where role is owner, moderator or null.");
    }
    const result = await setRole(f.store, f.entry, f.actor, body.wallet, role, deps);
    return result.ok ? json({ enabled: true }) : refuse(result.reason);
  };
}

/**
 * The profile as the API serves it: what the Owner set, the Club's X signals (ADR 0024), and
 * whether its memecoin earns the Holder badge (ADR 0026; null without one). `min` is base units.
 */
function publicProfile(entry: ClubEntry, profile: ClubProfile) {
  const { description, links, holdersOnlyPosts } = profile;
  const x = {
    accounts: (profile.x?.accounts ?? []).map(({ handle, proof, linkedAt }) => ({ handle, proof, linkedAt })),
    tags: profile.x?.tags ?? [],
    hint: signalsHint(signalsOf(entry, profile)),
  };
  let coin = null;
  if (entry.linked) {
    const rule = coinRule(entry.linked, profile.coinHolders);
    coin = { token: entry.linked.address.toLowerCase(), symbol: entry.linked.symbol, on: rule.on, min: rule.min.toString(), set: !!profile.coinHolders };
  }
  return { description, links, holdersOnlyPosts, x, coin };
}

type Fronted = Exclude<Awaited<ReturnType<typeof front>>, Response>;

/** GET (public, cached) and PATCH (staff, `club-mod`) of one Club document that can be edited: what `read` shows, what `write` saves. */
function clubDocHandlers(
  registry: Registry,
  deps: RouteDeps,
  read: (store: Store, entry: Fronted["entry"]) => Promise<object>,
  write: (f: Fronted, body: Record<string, unknown>) => Promise<{ ok: true; body: object } | { ok: false; reason: string; message?: string }>,
) {
  return {
    async GET(request: Request, ctx: Ctx) {
      const found = await publicRead(registry, ctx, request, { enabled: false });
      if (found instanceof Response) return found;
      return Response.json(
        { enabled: true, ...(await read(found.store, found.entry)) },
        { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
      );
    },
    async PATCH(request: Request, ctx: Ctx) {
      const f = await front(registry, ctx, request, deps, "club-mod");
      if (f instanceof Response) return f;
      const result = await write(f, await bodyOf(request));
      return result.ok ? json({ enabled: true, ...result.body }) : refuse(result.reason, result.message);
    },
  };
}

/** GET (public) and PATCH (Owner) /api/clubs/[token]/profile. */
export function profileHandlers(registry: Registry, deps: RouteDeps = {}) {
  return clubDocHandlers(
    registry,
    deps,
    async (store, entry) => ({ ...publicProfile(entry, await loadProfile(store, entry.address)), hasOwner: !!(await loadRoles(store, entry.address)).owner }),
    async (f, body) => {
      const result = await updateProfile(f.store, f.entry, f.actor, body, deps);
      return result.ok ? { ok: true, body: publicProfile(f.entry, result.profile) } : result;
    },
  );
}

/**
 * GET /api/clubs/[token]/rules: the Club's reward rules now, any change waiting for the next epoch,
 * and the bounds (public). PATCH, the Owner or an app admin: change some of them, from the next
 * epoch (ADR 0044).
 */
export function rulesHandlers(registry: Registry, deps: RouteDeps = {}) {
  return clubDocHandlers(
    registry,
    deps,
    (store, entry) => clubRulesView(store, entry, deps),
    async (f, body) => {
      const result = await updateRules(f.store, f.entry, f.actor, body, deps);
      return result.ok ? { ok: true, body: result.view } : result;
    },
  );
}

/**
 * Club challenges (ADR 0045, ADR 0049). GET (public) lists them, settling the ones that ended; POST
 * (the Owner or an app admin) starts one: `{ title, brief, judging, epochs, holdersOnly? }` with, for
 * `judging` "likes" | "holders" | "owner", `prizes: [points…]` (best first), and for "raffle" |
 * "first" | "everyone", `winners` and `prize` (points each), plus `minLikes` for "everyone"; and
 * optionally `rewards: { asset?: { token, amounts }, pinWinner? }` (ADR 0050).
 */
export function challengesHandlers(registry: Registry, deps: RouteDeps = {}) {
  return {
    async GET(request: Request, ctx: Ctx) {
      const read = await publicRead(registry, ctx, request, { enabled: false, challenges: [] });
      if (read instanceof Response) return read;
      const { entry, store } = read;
      const viewer = await softViewer(request, deps);
      const challenges = await listChallenges(store, entry, { userId: viewer?.id }, deps);
      const cache = viewer ? "private, no-store" : "public, s-maxage=10, stale-while-revalidate=30";
      return Response.json({ enabled: true, challenges }, { headers: { "Cache-Control": cache } });
    },
    async POST(request: Request, ctx: Ctx) {
      const f = await front(registry, ctx, request, deps, "club-mod");
      if (f instanceof Response) return f;
      const result = await createChallenge(f.store, f.entry, f.actor, await bodyOf(request), { ...deps, registry });
      return result.ok ? json({ enabled: true, id: result.id }, 201) : refuse(result.reason, result.message);
    },
  };
}

/**
 * GET /api/clubs/[token]/challenges/[id]: one challenge with its entries.
 * POST /api/clubs/[token]/challenges/[id]  { action }, where action is
 *   "enter" { post }  a member enters one of their Board posts,
 *   "withdraw"        a member takes their entry back,
 *   "pick" { posts }  the Owner names the winners of a challenge they judge, best first,
 *   "cancel"          the Owner calls it off,
 *   "prize_sent" { post, tx }  the Owner reports a winner's asset prize sent; checked on chain (ADR 0050).
 */
export function challengeHandlers(registry: Registry, deps: RouteDeps = {}) {
  return {
    /** GET (public): the challenge with its entries, or 404. */
    async GET(request: Request, ctx: ItemCtx) {
      const read = await publicRead(registry, ctx, request, { enabled: false });
      if (read instanceof Response) return read;
      const { entry, store } = read;
      const viewer = await softViewer(request, deps);
      const challenge = await getChallenge(store, entry, (await ctx.params).id, { userId: viewer?.id }, deps);
      if (!challenge) return refuse("not_found");
      const cache = viewer ? "private, no-store" : "public, s-maxage=10, stale-while-revalidate=30";
      return Response.json({ enabled: true, challenge }, { headers: { "Cache-Control": cache } });
    },
    async POST(request: Request, ctx: ItemCtx) {
      const f = await front(registry, ctx, request, deps, "club-challenge");
      if (f instanceof Response) return f;
      const id = (await ctx.params).id;
      const body = await bodyOf(request);
      const result =
        body.action === "enter"
          ? await enterChallenge(f.store, f.entry, f.user.id, id, body.post, deps)
          : body.action === "withdraw"
            ? await withdrawEntry(f.store, f.entry, f.user.id, id, deps)
            : body.action === "pick"
              ? await pickWinners(f.store, f.entry, f.actor, id, body.posts, deps)
              : body.action === "cancel"
                ? await cancelChallenge(f.store, f.entry, f.actor, id, deps)
                : body.action === "prize_sent"
                  ? await sendPrize(f.store, f.entry, f.actor, id, { post: body.post, tx: body.tx }, deps)
                  : null;
      if (!result) return refuse("invalid", 'Send { action: "enter" | "withdraw" | "pick" | "cancel" | "prize_sent" }.');
      if (!result.ok && result.reason === "holders_only")
        return refuse("holders_only", "This challenge is for Holders: you need to hold the Club’s asset to enter.");
      return result.ok
        ? json({ enabled: true })
        : refuse(result.reason, "message" in result && typeof result.message === "string" ? result.message : undefined);
    },
  };
}

/**
 * Bans from rewards (ADR 0044). GET lists them (staff); POST `{ wallet }` bans a member by their Club
 * wallet and DELETE `{ wallet }` lifts it (the Owner or an app admin).
 */
export function rewardBansHandlers(registry: Registry, deps: RouteDeps = {}) {
  const act = (ban: boolean) =>
    async function (request: Request, ctx: Ctx) {
      const f = await front(registry, ctx, request, deps, "club-mod");
      if (f instanceof Response) return f;
      const result = await setRewardBan(f.store, f.entry, f.actor, (await bodyOf(request)).wallet, ban, deps);
      return result.ok
        ? json({ enabled: true, wallet: result.wallet })
        : refuse(result.reason, result.reason === "invalid" ? "Give the member's Club wallet (not your own)." : undefined);
    };
  return {
    async GET(request: Request, ctx: Ctx) {
      const f = await front(registry, ctx, request, deps, "club-mod");
      if (f instanceof Response) return f;
      const bans = await listRewardBans(f.store, f.entry, f.user.id, deps);
      return bans ? json({ enabled: true, bans }) : refuse("forbidden");
    },
    POST: act(true),
    DELETE: act(false),
  };
}

/**
 * POST /api/clubs/[token]/x  { action: "start", handle } → the code to post from that account;
 *                            { action: "verify", handle, url } → links it, if the post has the code.
 * DELETE /api/clubs/[token]/x  { handle } → unlinks it. The Owner or an app admin (ADR 0024).
 */
export function xLinkHandlers(registry: Registry, deps: RouteDeps = {}) {
  return {
    async POST(request: Request, ctx: Ctx) {
      const f = await front(registry, ctx, request, deps, "club-mod");
      if (f instanceof Response) return f;
      const body = await bodyOf(request);
      if (body.action === "start") {
        const result = await startXLink(f.store, f.entry, f.actor, body.handle, deps);
        return result.ok ? json({ enabled: true, handle: result.handle, code: result.code, text: result.text, until: result.until }) : refuse(result.reason);
      }
      if (body.action === "verify") {
        const result = await verifyXLink(f.store, f.entry, f.actor, { handle: body.handle, url: body.url }, deps);
        return result.ok ? json({ enabled: true, ...publicProfile(f.entry, result.profile) }) : refuse(result.reason);
      }
      return refuse("invalid", 'Send { action: "start", handle } or { action: "verify", handle, url }.');
    },
    async DELETE(request: Request, ctx: Ctx) {
      const f = await front(registry, ctx, request, deps, "club-mod");
      if (f instanceof Response) return f;
      const result = await unlinkX(f.store, f.entry, f.actor, (await bodyOf(request)).handle, deps);
      return result.ok ? json({ enabled: true, ...publicProfile(f.entry, result.profile) }) : refuse(result.reason);
    },
  };
}

/** GET /api/clubs/[token]/log: the moderation log. Staff only; admins also see an ownership check. */
export function logHandler(registry: Registry, deps: RouteDeps = {}) {
  return async function GET(request: Request, ctx: Ctx) {
    const f = await front(registry, ctx, request, deps, "club-mod");
    if (f instanceof Response) return f;
    const role = await roleIn(f.store, f.entry.address, f.user.id, deps);
    if (!isStaff(role)) return refuse("forbidden");
    const ownership = role === "admin" ? await ownershipCheck(f.store, f.entry, deps) : null;
    return json({ enabled: true, log: await readLog(f.store, f.entry.address), ownership });
  };
}

/**
 * DELETE /api/clubs/[token]: delete everything stored for a Club that is hidden from the list
 * (blocked, or no longer on it). App admins only. A live Club can't be purged: take it off the
 * list first.
 */
export function purgeHandler(registry: Registry, deps: RouteDeps = {}) {
  return async function DELETE(request: Request, ctx: Ctx) {
    const { token } = await ctx.params;
    if (!isAddress(token, { strict: false })) return fail(400, "bad_request", "Give a token address.");
    const g = await (deps.gate ?? gateUser)(request, "club-purge", 10);
    if (g instanceof Response) return g;
    if (!(deps.admins ?? adminIds()).has(g.user.id)) return refuse("forbidden");
    if (registry.clubFor(token)) return refuse("not_hidden");
    return json({ enabled: true, purged: await purgeClub(g.store, token) });
  };
}
