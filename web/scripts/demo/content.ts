/**
 * The demo world `scripts/demo.ts` builds on Monad testnet: who holds what in the three mirrored
 * collections, the swaps they make, and what they post. Every persona is invented and shows a
 * Discord handle, which the app doesn't link anywhere, so no persona points at a real X account.
 *
 * "you" is the presenter's own wallet (DEMO_PRESENTER_WALLET): it holds in all three Clubs and
 * owns the Chog Club, but posts nothing here; the presenter posts live.
 */

export type ClubKey = "chog" | "skrumpeys" | "r3tards";
export type PersonaKey =
  | "mika"
  | "oatmilk"
  | "nadsworth"
  | "candle"
  | "lou"
  | "warden"
  | "bulmba"
  | "hanoi"
  | "intern"
  | "cope"
  | "slow"
  | "tide"
  | "fresh";
export type HolderKey = PersonaKey | "you";

/** The Discord username each persona's profile shows (lowercase, 2 to 32 of a-z 0-9 _ .). */
export const PERSONAS: Record<PersonaKey, { handle: string }> = {
  mika: { handle: "mika.onchain" },
  oatmilk: { handle: "oatmilk_chad" },
  nadsworth: { handle: "nadsworth" },
  candle: { handle: "purple.candle" },
  lou: { handle: "lowfloor_lou" },
  warden: { handle: "pixel.warden" },
  bulmba: { handle: "bulmba_enjoyer" },
  hanoi: { handle: "gm.from.hanoi" },
  intern: { handle: "intern_zero" },
  cope: { handle: "certified.cope" },
  slow: { handle: "slowblocks" },
  tide: { handle: "tidepoolz" },
  fresh: { handle: "fresh.wallet" },
};

export const CLUBS: Record<ClubKey, { env: string; name: string; mainnet: string; image: string; art: string; owner: HolderKey; moderators: PersonaKey[]; description: string; tags: string[] }> = {
  chog: {
    env: "DEMO_CHOG_ADDRESS",
    name: "Chog Genesis",
    mainnet: "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763",
    image: "/art/clubs/chog.png",
    art: "ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/1462.json",
    owner: "you",
    moderators: ["mika"],
    description:
      "1,969 Chogs, the first PFP on Monad. This Club is where holders trade, post and split the fees their swaps pay. Testnet mirror of the mainnet collection: same ids, same art.",
    tags: ["chog", "#chog", "$chog"],
  },
  skrumpeys: {
    env: "DEMO_SKRUMPEYS_ADDRESS",
    name: "skrumpeys",
    mainnet: "0xb0dad798c80e40dd6b8e8545074c6a5b7b97d2c0",
    image: "/art/clubs/skrumpeys.png",
    art: "https://evmfs.xyz/143/107912197/0xea267b4d1b58b7ece2b50010670b565fb8f59da5af5c08ec0fdce7bea8c66f25/1",
    owner: "warden",
    moderators: ["bulmba"],
    description:
      "3,333 pixel skrumps capturing Monad's spirit. Post your skrump, swap traits, and keep the board weird. Testnet mirror of the mainnet collection: same ids, same art.",
    tags: ["skrumpeys", "skrump", "#skrumpeys"],
  },
  r3tards: {
    env: "DEMO_R3TARDS_ADDRESS",
    name: "r3tards",
    mainnet: "0x200723a706de0013316e5cd8eba2b3f53dd90c29",
    image: "/art/clubs/r3tards.png",
    art: "https://www.scatter.art/api/instareveal/mfrvr5upu9925ja07o6ckk6v/1",
    owner: "intern",
    moderators: [],
    description:
      "1,033 certified r3tards on the Monad blockchain. Interns welcome. Testnet mirror of the mainnet collection: same ids, same art.",
    tags: ["r3tards", "#r3tards"],
  },
};

/** Minted in this order, so each holder's token ids are a run that follows the one before. */
export const HOLDINGS: Record<ClubKey, [HolderKey, number][]> = {
  chog: [["you", 3], ["mika", 6], ["oatmilk", 4], ["nadsworth", 3], ["candle", 2], ["lou", 2], ["hanoi", 1], ["slow", 1]],
  skrumpeys: [["warden", 5], ["bulmba", 4], ["hanoi", 3], ["you", 2], ["mika", 2], ["tide", 2], ["lou", 1], ["cope", 1]],
  r3tards: [["intern", 5], ["cope", 4], ["you", 2], ["tide", 2], ["oatmilk", 2], ["slow", 2], ["candle", 1], ["nadsworth", 1]],
};

/** Who joins which Club, besides the holders (who join every Club they hold in). */
export const EXTRA_MEMBERS: [PersonaKey, ClubKey][] = [
  ["fresh", "chog"],
  ["fresh", "r3tards"],
  ["warden", "chog"],
];

/** One side of a swap: the holder's n-th token (from 0) of a collection, or MON. */
export type Side = { nft: [ClubKey, number] } | { mon: string };
export type Trade = { maker: PersonaKey; gives: Side; wants: Side; taker?: PersonaKey; ref?: string };

/**
 * Real DeClubEscrow swaps, sent in order. With a `taker` the trade is filled at once; without one
 * it stays open, and a "looking" post (`ref`) links to it. A token only changes hands once, so the
 * holdings above still say who owns every token the later trades name.
 */
export const TRADES: Trade[] = [
  { maker: "mika", gives: { nft: ["chog", 0] }, wants: { nft: ["skrumpeys", 0] }, taker: "warden" },
  { maker: "oatmilk", gives: { nft: ["chog", 0] }, wants: { mon: "0.08" }, taker: "lou" },
  { maker: "cope", gives: { nft: ["r3tards", 0] }, wants: { nft: ["skrumpeys", 0] }, taker: "bulmba" },
  { maker: "intern", gives: { nft: ["r3tards", 0] }, wants: { mon: "0.05" }, taker: "tide" },
  { maker: "nadsworth", gives: { nft: ["chog", 0] }, wants: { nft: ["r3tards", 1] }, taker: "cope" },
  { maker: "hanoi", gives: { nft: ["skrumpeys", 0] }, wants: { mon: "0.06" }, taker: "mika" },
  { maker: "candle", gives: { nft: ["chog", 0] }, wants: { nft: ["skrumpeys", 0] }, taker: "tide" },
  { maker: "mika", gives: { nft: ["chog", 1] }, wants: { mon: "0.3" }, ref: "mika-chog" },
  { maker: "bulmba", gives: { nft: ["skrumpeys", 1] }, wants: { mon: "0.1" }, ref: "bulmba-skrump" },
  { maker: "cope", gives: { nft: ["r3tards", 2] }, wants: { mon: "0.12" }, ref: "cope-r3tard" },
];

/**
 * Board posts. `ago` is how long before the social step ran, in hours; the ones that talk about
 * this run's swaps are minutes old, so they come after them. A post with `ref` is a "looking" post
 * linking the open trade of that name. `pin` pins it (the Owner's posts).
 */
export type Post = { club: ClubKey; by: PersonaKey; ago: number; text: string; ref?: string; pin?: boolean };

export const POSTS: Post[] = [
  // Chog
  { club: "chog", by: "mika", ago: 290, text: "gm Chogs. Club board is live, first post goes to the OGs." },
  { club: "chog", by: "oatmilk", ago: 262, text: "Floor talk aside, the Rewards split is the real alpha: half the fees come back to holders every epoch." },
  { club: "chog", by: "nadsworth", ago: 230, text: "Anyone else hold their Chog since the mint? Never listed, never will. Swapping is different though." },
  { club: "chog", by: "candle", ago: 190, text: "Background tier list: purple > night > everything else. Fight me." },
  { club: "chog", by: "lou", ago: 0.08, text: "Bought my first Chog here, 0.08 MON straight from oatmilk. Took 30 seconds and I didn't have to trust anyone." },
  { club: "chog", by: "fresh", ago: 120, text: "New here, no Chog yet. Lurking the board to learn the lore before I buy in." },
  { club: "chog", by: "hanoi", ago: 70, text: "Chog + skrump pair on my profile now. Monad PFP maxi." },
  { club: "chog", by: "slow", ago: 40, text: "Momentum on this Club is climbing. Every swap counts, so keep them coming." },
  { club: "chog", by: "mika", ago: 0.03, text: "One of mine is up for 0.3 MON. Holders get first look.", ref: "mika-chog" },
  // skrumpeys
  { club: "skrumpeys", by: "warden", ago: 300, text: "Welcome to the skrumpeys Club. Post your skrump, keep it kind, swap what you don't love.", pin: true },
  { club: "skrumpeys", by: "bulmba", ago: 270, text: "Bulmba background gang where you at" },
  { club: "skrumpeys", by: "hanoi", ago: 210, text: "Pixel art at this size is hard. Every skrump reads at 32px. Respect to the artist." },
  { club: "skrumpeys", by: "tide", ago: 150, text: "Two skrumps and two r3tards. Cross-Club life." },
  { club: "skrumpeys", by: "lou", ago: 100, text: "Poop hat is the best hat. This is not a debate." },
  { club: "skrumpeys", by: "cope", ago: 0.07, text: "Traded a r3tard for a skrump today. Cross-Club swaps are underrated." },
  { club: "skrumpeys", by: "warden", ago: 20, text: "Club fund update: the Owner share goes back into the community. More on that this week." },
  { club: "skrumpeys", by: "bulmba", ago: 0.03, text: "Letting one of my skrumps go for 0.1 MON.", ref: "bulmba-skrump" },
  // r3tards
  { club: "r3tards", by: "intern", ago: 280, text: "Certified. Club is open. Interns, report to the board.", pin: true },
  { club: "r3tards", by: "cope", ago: 240, text: "Being early to a 1,033 collection hits different." },
  { club: "r3tards", by: "slow", ago: 180, text: "Rewards epoch math: holders split half the fees by holdings, plus a bonus if you actually trade." },
  { club: "r3tards", by: "oatmilk", ago: 130, text: "Picked up two r3tards. My Chogs needed coworkers." },
  { club: "r3tards", by: "fresh", ago: 90, text: "Member, not a holder yet. Board still lets me post, which is nice." },
  { club: "r3tards", by: "tide", ago: 0.06, text: "Bought another r3tard off intern for 0.05 MON. Intern energy." },
  { club: "r3tards", by: "cope", ago: 0.03, text: "One r3tard for 0.12 MON, open to anyone.", ref: "cope-r3tard" },
];

/** Who follows whom (the presenter's wallet is "you"). */
export const FOLLOWS: [PersonaKey, HolderKey][] = [
  ["mika", "you"], ["oatmilk", "you"], ["nadsworth", "you"], ["lou", "you"], ["warden", "you"], ["intern", "you"],
  ["oatmilk", "mika"], ["nadsworth", "mika"], ["candle", "mika"], ["lou", "mika"], ["fresh", "mika"],
  ["bulmba", "warden"], ["hanoi", "warden"], ["tide", "warden"], ["lou", "warden"],
  ["cope", "intern"], ["slow", "intern"], ["tide", "intern"], ["fresh", "intern"],
  ["mika", "warden"], ["warden", "mika"], ["intern", "cope"], ["hanoi", "mika"],
];
