/**
 * The demo world `scripts/demo.ts` builds on Monad testnet: who holds what in the three mirrored
 * collections, the swaps they make, and what they post. Every persona is invented and shows a
 * Discord handle, which the app doesn't link anywhere, so no persona points at a real X account.
 *
 * "you" is the presenter's own wallet (DEMO_PRESENTER_WALLET): it holds in all three Clubs and
 * owns the Chog Club, but posts nothing here; the presenter posts live.
 */

export type ClubKey = "chog" | "skrumpeys" | "r3tards";
export type PersonaKey = "mika" | "oatmilk" | "nadsworth" | "candle" | "lou" | "warden" | "bulmba" | "hanoi" | "intern" | "cope" | "slow" | "tide" | "fresh";
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

export const CLUBS: Record<
  ClubKey,
  { env: string; name: string; mainnet: string; image: string; art: string; owner: HolderKey; moderators: PersonaKey[]; description: string; tags: string[] }
> = {
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
    description: "1,033 certified r3tards on the Monad blockchain. Interns welcome. Testnet mirror of the mainnet collection: same ids, same art.",
    tags: ["r3tards", "#r3tards"],
  },
};

/** Minted in this order, so each holder's token ids are a run that follows the one before. */
export const HOLDINGS: Record<ClubKey, [HolderKey, number][]> = {
  chog: [
    ["you", 3],
    ["mika", 6],
    ["oatmilk", 4],
    ["nadsworth", 3],
    ["candle", 2],
    ["lou", 2],
    ["hanoi", 1],
    ["slow", 1],
  ],
  skrumpeys: [
    ["warden", 5],
    ["bulmba", 4],
    ["hanoi", 3],
    ["you", 2],
    ["mika", 2],
    ["tide", 2],
    ["lou", 1],
    ["cope", 1],
  ],
  r3tards: [
    ["intern", 5],
    ["cope", 4],
    ["you", 2],
    ["tide", 2],
    ["oatmilk", 2],
    ["slow", 2],
    ["candle", 1],
    ["nadsworth", 1],
  ],
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

/**
 * Club challenges (ADR 0045, 0048-0050), one of every judging mode and phase, for testing the
 * Challenges tab. The Owner of the Club starts each one.
 *
 * - "open": started in the running epoch through the app's own functions, so it is still running;
 *   entries are signed Board posts sharing an X post, entered and liked at their own times.
 * - "ended": ran over the four days before the running epoch began and ended with it, written to the
 *   store as the app would have, then settled by the app now (an Owner-judged one is left to pick).
 * - "cancelled": started now, then called off by its Owner.
 *
 * An entry's `at` is how far into the challenge it was posted (0 to 1). Each entry shares an invented
 * X post under a `dcdemo_` handle; `likes` are the members who liked it. The Club's Owner can't enter.
 */
export type ChallengeEntry = { by: PersonaKey; at: number; post: string; x: string; likes?: PersonaKey[] };
export type DemoChallenge = {
  key: string;
  club: ClubKey;
  when: "open" | "ended" | "cancelled";
  /** What the Owner's form sends, without `epochs` for one that ended (it ran one). */
  input: Record<string, unknown>;
  entries: ChallengeEntry[];
};

export const CHALLENGES: DemoChallenge[] = [
  // Chog: the presenter is the Owner, so this is where they pick winners and send a prize.
  {
    key: "chog-caption",
    club: "chog",
    when: "open",
    input: {
      title: "Caption this Chog",
      brief: "Post your Chog on X with your best caption. I pick my three favourites when it ends.",
      judging: "owner",
      prizes: [10, 5, 2],
      epochs: 2,
      holdersOnly: false,
    },
    entries: [
      {
        by: "mika",
        at: 0.1,
        post: "Entry for the caption challenge 👇",
        x: "when the gas is 0.0001 and you still check twice #chog",
        likes: ["oatmilk", "lou", "slow"],
      },
      { by: "candle", at: 0.3, post: "My caption entry", x: "purple background, purple mood, purple bags. chog szn", likes: ["mika"] },
      { by: "nadsworth", at: 0.55, post: "Caption entry, be kind", x: "held since mint. not a flex, just a lifestyle #chog" },
      {
        by: "fresh",
        at: 0.8,
        post: "No Chog yet but here's a caption",
        x: "me refreshing the chog floor every 4 minutes like it owes me money",
        likes: ["mika", "candle"],
      },
    ],
  },
  {
    key: "chog-backgrounds",
    club: "chog",
    when: "open",
    input: {
      title: "Background raffle",
      brief: "Share your Chog's background on X. Three Holders win, drawn at random when the epoch ends.",
      judging: "raffle",
      winners: 3,
      prize: 3,
      epochs: 1,
      holdersOnly: true,
      rewards: { pinWinner: true },
    },
    entries: [
      { by: "oatmilk", at: 0.15, post: "Night background, entering the raffle", x: "night background chog. the rarest vibe in the collection #chog" },
      { by: "hanoi", at: 0.35, post: "Raffle entry from Hanoi", x: "gm from hanoi, chog on a teal background, coffee in hand" },
      { by: "slow", at: 0.6, post: "In for the raffle", x: "plain background, loud chog. #chog" },
      { by: "lou", at: 0.85, post: "My first Chog, entering", x: "bought my first chog this week, lavender background. in love" },
    ],
  },
  {
    key: "chog-lore",
    club: "chog",
    when: "ended",
    input: {
      title: "Chog lore thread",
      brief: "Write a short Chog origin story on X. I'll pick the best two.",
      judging: "owner",
      prizes: [8, 4],
      holdersOnly: false,
    },
    entries: [
      {
        by: "mika",
        at: 0.1,
        post: "Lore thread is up",
        x: "chapter 1: the first chog hatched on block 1 and immediately asked for a swap",
        likes: ["oatmilk", "candle", "slow"],
      },
      { by: "oatmilk", at: 0.3, post: "My lore entry", x: "the chogs aren't from monad. monad is from the chogs. thread 🧵", likes: ["mika"] },
      { by: "candle", at: 0.5, post: "Lore, purple edition", x: "every chog is born purple. the other colours are what they traded for" },
      { by: "slow", at: 0.75, post: "Short lore from me", x: "a chog never sells. a chog swaps. that's the whole lore", likes: ["mika", "nadsworth"] },
    ],
  },
  {
    key: "chog-edit",
    club: "chog",
    when: "ended",
    input: {
      title: "Best Chog edit",
      brief: "Edit your Chog into a meme and post it on X. Most liked wins; 1st place also gets a Chog from me.",
      judging: "likes",
      prizes: [10, 5, 2],
      holdersOnly: false,
      rewards: { asset: { token: "chog", amounts: ["1", "0", "0"] } },
    },
    entries: [
      { by: "mika", at: 0.1, post: "Chog edit entry", x: "chog but it's a 2007 desktop wallpaper", likes: ["oatmilk", "nadsworth", "lou", "hanoi"] },
      { by: "oatmilk", at: 0.25, post: "Edited my Chog", x: "chog as a barista. oat milk only", likes: ["mika", "slow"] },
      { by: "nadsworth", at: 0.45, post: "Edit entry", x: "chog in the matrix, dodging gas fees", likes: ["mika", "oatmilk", "candle"] },
      { by: "hanoi", at: 0.6, post: "My Chog edit", x: "chog on a motorbike in the old quarter", likes: ["slow"] },
      { by: "lou", at: 0.8, post: "First edit ever", x: "chog but low floor. get it" },
    ],
  },
  // skrumpeys: the presenter is a member and a Holder here, so they can enter the open ones.
  {
    key: "skrump-poll",
    club: "skrumpeys",
    when: "cancelled",
    input: {
      title: "Trait poll",
      brief: "Post your favourite skrump trait. Called off: we'll run it as a Board poll instead.",
      judging: "likes",
      prizes: [5],
      epochs: 1,
      holdersOnly: false,
    },
    entries: [],
  },
  {
    key: "skrump-rate",
    club: "skrumpeys",
    when: "open",
    input: {
      title: "Rate my skrump",
      brief: "Post your skrump on X with one line about it. Most liked by the Club wins.",
      judging: "likes",
      prizes: [10, 5, 2],
      epochs: 1,
      holdersOnly: false,
    },
    entries: [
      { by: "bulmba", at: 0.1, post: "Rate it 👀", x: "bulmba background skrump. 10/10, no notes #skrumpeys", likes: ["hanoi", "tide", "lou", "mika"] },
      { by: "hanoi", at: 0.3, post: "Entry", x: "this skrump reads perfectly at 32px. art. #skrumpeys", likes: ["bulmba", "cope"] },
      { by: "tide", at: 0.5, post: "My skrump for the challenge", x: "tidepool skrump, slightly damp, fully committed", likes: ["bulmba", "hanoi", "mika"] },
      { by: "lou", at: 0.75, post: "Poop hat entry", x: "poop hat skrump. undefeated. #skrumpeys" },
    ],
  },
  {
    key: "skrump-first",
    club: "skrumpeys",
    when: "open",
    input: {
      title: "First five skrumps",
      brief: "The first five members to share their skrump on X win. Still spots left.",
      judging: "first",
      winners: 5,
      prize: 2,
      epochs: 2,
      holdersOnly: false,
    },
    entries: [
      { by: "hanoi", at: 0.05, post: "First in?", x: "skrump posted, gm skrumpeys" },
      { by: "mika", at: 0.2, post: "In", x: "my one skrump next to my chogs. it fits #skrumpeys", likes: ["hanoi"] },
      { by: "cope", at: 0.4, post: "Third, I think", x: "got this skrump for a r3tard. cross-club swaps rule" },
    ],
  },
  {
    key: "skrump-vote",
    club: "skrumpeys",
    when: "ended",
    input: {
      title: "Skrump of the week",
      brief: "Post your skrump on X. Only Holders' likes count. Results get pinned.",
      judging: "holders",
      prizes: [10, 5],
      holdersOnly: false,
      rewards: { pinWinner: true },
    },
    entries: [
      { by: "bulmba", at: 0.1, post: "Skrump of the week entry", x: "this skrump has been through things. #skrumpeys", likes: ["hanoi", "tide", "mika"] },
      { by: "hanoi", at: 0.3, post: "My entry", x: "sunrise skrump from hanoi", likes: ["bulmba", "lou", "cope", "tide"] },
      { by: "tide", at: 0.5, post: "Entry", x: "two skrumps, one picture, zero regrets", likes: ["bulmba"] },
      { by: "lou", at: 0.7, post: "Entering", x: "low floor skrump, high ceiling energy", likes: ["mika", "cope"] },
      { by: "mika", at: 0.9, post: "Last minute entry", x: "skrump with a chog in the background. collab #skrumpeys" },
    ],
  },
  {
    key: "skrump-raffle",
    club: "skrumpeys",
    when: "ended",
    input: {
      title: "Meme raffle",
      brief: "Post a skrump meme on X. Two winners are drawn when it ends, from a block anyone can check.",
      judging: "raffle",
      winners: 2,
      prize: 4,
      holdersOnly: false,
    },
    entries: [
      { by: "bulmba", at: 0.1, post: "Raffle entry", x: "skrump explaining monad to his parents" },
      { by: "hanoi", at: 0.25, post: "Meme entry", x: "skrump waiting for a block that already happened" },
      { by: "tide", at: 0.4, post: "In for the raffle", x: "me vs the skrump i didn't buy" },
      { by: "lou", at: 0.55, post: "Raffle", x: "poop hat skrump at a job interview" },
      { by: "cope", at: 0.7, post: "Entry", x: "certified cope, certified skrump" },
      { by: "mika", at: 0.85, post: "Meme for the raffle", x: "skrump when the swap fills in 400ms" },
    ],
  },
  // r3tards: the presenter is a member and a Holder here too.
  {
    key: "r3tard-orientation",
    club: "r3tards",
    when: "open",
    input: {
      title: "Intern orientation",
      brief: "Post your r3tard on X and get 2 likes from the Club. Up to three who make it win, plus a r3tard each.",
      judging: "everyone",
      winners: 3,
      prize: 3,
      minLikes: 2,
      epochs: 2,
      holdersOnly: false,
      rewards: { asset: { token: "r3tards", amounts: ["1"] } },
    },
    entries: [
      {
        by: "cope",
        at: 0.1,
        post: "Reporting for orientation",
        x: "r3tard orientation day 1: found the coffee machine #r3tards",
        likes: ["tide", "oatmilk", "slow"],
      },
      { by: "tide", at: 0.35, post: "Orientation entry", x: "my r3tard has more experience than me. #r3tards", likes: ["cope"] },
      { by: "oatmilk", at: 0.6, post: "Entering", x: "my chogs met my r3tards. hr is involved", likes: ["cope", "slow"] },
      { by: "slow", at: 0.85, post: "Orientation", x: "slow blocks, fast r3tards" },
    ],
  },
  {
    key: "r3tard-desk",
    club: "r3tards",
    when: "open",
    input: {
      title: "Best desk setup",
      brief: "Show your desk with your r3tard on screen. Holders only, Holders' likes decide.",
      judging: "holders",
      prizes: [6, 3],
      epochs: 1,
      holdersOnly: true,
    },
    entries: [
      { by: "cope", at: 0.2, post: "Desk entry", x: "three monitors, one r3tard, zero productivity #r3tards", likes: ["slow", "candle", "tide"] },
      { by: "slow", at: 0.45, post: "My desk", x: "laptop on a box. r3tard wallpaper. it works", likes: ["fresh", "cope"] },
      { by: "candle", at: 0.7, post: "Desk with candles, obviously", x: "purple candles and a r3tard on screen. ambience", likes: ["oatmilk"] },
    ],
  },
  {
    key: "r3tard-first",
    club: "r3tards",
    when: "ended",
    input: {
      title: "First r3tard on X",
      brief: "The first three to post their r3tard on X win a trophy. Just a trophy.",
      judging: "first",
      winners: 3,
      prize: 0,
      holdersOnly: false,
    },
    entries: [
      { by: "cope", at: 0.05, post: "First", x: "first r3tard on the timeline #r3tards" },
      { by: "tide", at: 0.15, post: "Second?", x: "r3tard posted. intern energy" },
      { by: "oatmilk", at: 0.3, post: "Entry", x: "my r3tards, my rules" },
      { by: "slow", at: 0.5, post: "Too slow probably", x: "slowblocks strikes again" },
      { by: "nadsworth", at: 0.7, post: "Late entry", x: "one r3tard, one chog, one wallet" },
    ],
  },
];

/** Who follows whom (the presenter's wallet is "you"). */
export const FOLLOWS: [PersonaKey, HolderKey][] = [
  ["mika", "you"],
  ["oatmilk", "you"],
  ["nadsworth", "you"],
  ["lou", "you"],
  ["warden", "you"],
  ["intern", "you"],
  ["oatmilk", "mika"],
  ["nadsworth", "mika"],
  ["candle", "mika"],
  ["lou", "mika"],
  ["fresh", "mika"],
  ["bulmba", "warden"],
  ["hanoi", "warden"],
  ["tide", "warden"],
  ["lou", "warden"],
  ["cope", "intern"],
  ["slow", "intern"],
  ["tide", "intern"],
  ["fresh", "intern"],
  ["mika", "warden"],
  ["warden", "mika"],
  ["intern", "cope"],
  ["hanoi", "mika"],
];
