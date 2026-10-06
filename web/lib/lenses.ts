import type { StoredPost } from "./clubPosts";

/**
 * Feed lenses (ADR 0023): how a Club's Board is ordered is the reader's choice, not the app's. A
 * lens is a pure function over the posts and a little public context, so anyone can write one:
 * every input is public (the signed-post export, the Members list, follows), and a third party can
 * rank the same records their own way. Pinned posts stay on top except where a lens says otherwise.
 */
export type LensPost = Pick<StoredPost, "id" | "wallet" | "kind" | "at">;

export type LensContext = {
  /** Epoch ms. */
  now: number;
  /** Lowercase wallets the reader follows. Empty when they follow nobody or didn't say who they are. */
  follows: ReadonlySet<string>;
  /** Lowercase Club wallets of members who hold the Club's asset. */
  holders: ReadonlySet<string>;
  /** Member Momentum by lowercase Club wallet. */
  momentum: ReadonlyMap<string, number>;
};

export type Lens = {
  id: LensId;
  name: string;
  description: string;
  /** Whether pinned posts go first. */
  pins: boolean;
  rank<T extends LensPost>(posts: readonly T[], ctx: LensContext): T[];
};

export type LensId = "newest" | "momentum" | "holders" | "following";

const newestFirst = <T extends LensPost>(posts: readonly T[]) => [...posts].sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));

/** A post's weight halves every this many hours under the Momentum lens. */
export const MOMENTUM_LENS_HALF_LIFE_H = 24;

export const LENSES: readonly Lens[] = [
  {
    id: "newest",
    name: "Newest",
    description: "Every post, newest first.",
    pins: true,
    rank: (posts) => newestFirst(posts),
  },
  {
    id: "momentum",
    name: "Most active",
    description: "Posts from the members most active here (trading, and their X posts about the Club) rise; older posts sink.",
    pins: true,
    rank(posts, ctx) {
      const weight = (p: LensPost) =>
        (1 + (ctx.momentum.get(p.wallet.toLowerCase()) ?? 0)) * 0.5 ** ((ctx.now - p.at) / (MOMENTUM_LENS_HALF_LIFE_H * 3_600_000));
      return [...posts].sort((a, b) => weight(b) - weight(a) || b.at - a.at);
    },
  },
  {
    id: "holders",
    name: "Holders",
    description: "Only posts from members who hold the Club’s asset.",
    pins: true,
    rank: (posts, ctx) => newestFirst(posts.filter((p) => ctx.holders.has(p.wallet.toLowerCase()))),
  },
  {
    id: "following",
    name: "Following",
    description: "Only posts from wallets you follow.",
    pins: false,
    rank: (posts, ctx) => newestFirst(posts.filter((p) => ctx.follows.has(p.wallet.toLowerCase()))),
  },
];

export const lensOf = (id: unknown): Lens => LENSES.find((l) => l.id === id) ?? LENSES[0]!;
