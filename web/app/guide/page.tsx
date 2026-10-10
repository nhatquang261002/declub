import type { Metadata } from "next";
import Link from "next/link";
import {
  BadgeCheckIcon,
  ChatIcon,
  CoinIcon,
  CrossIcon,
  CrownIcon,
  FlagIcon,
  FlameIcon,
  HeartIcon,
  ListIcon,
  PinIcon,
  ShieldIcon,
  SwapIcon,
  TagIcon,
  TrophyIcon,
  UsersIcon,
  XLogoIcon,
} from "@/components/Icons";
import { JudgingIcon } from "@/components/ChallengeCard";
import { CHALLENGE_RULES, JUDGING, type Judging } from "@/lib/challenges";
import { MAX_MODERATORS } from "@/lib/clubRoles";
import { MAX_LINKS, MAX_PINNED, POST_COOLDOWN_SEC, POST_MAX, POSTS_PER_HOUR } from "@/lib/clubPosts";
import { PRIVY_APP_ID } from "@/lib/config";
import { swapIntents } from "@/lib/contracts";
import { LENSES } from "@/lib/lenses";
import { MOMENTUM } from "@/lib/momentum";
import { NETWORK } from "@/lib/network";
import { DEFAULT_CLUB_RULES, PROTOCOL, percent } from "@/lib/rewards";
import { CARD, CardGrid, GuideBody, GuideEnd, GuideHero, MUTED, Section, Steps, type GuideSection } from "./parts";

// The main Guide, and the first thing a newcomer reads: what DeClub is, how to start and how to earn come first, the
// details after. The Deals guide sits beside it at /guide/deals. The numbers come from the same constants the server
// enforces, so the page can't drift from the rules. The longer version is the Clubs section of docs/07-user-guide.md.

const SECTIONS: GuideSection[] = [
  { id: "what", label: "What DeClub is" },
  { id: "start", label: "Get started" },
  { id: "trade", label: "Trade" },
  { id: "rewards", label: "Earn rewards" },
  { id: "challenges", label: "Challenges" },
  { id: "post", label: "Post and report" },
  { id: "club", label: "Inside a Club" },
  { id: "roles", label: "Who runs a Club" },
  { id: "grow", label: "Grow a Club" },
  { id: "safety", label: "Stay safe" },
  { id: "faq", label: "FAQ" },
];

/** The whole idea, in four cards: what someone new needs before anything else. */
const PILLARS = [
  {
    icon: <UsersIcon className="size-4" />,
    title: "Join your Club",
    body: "Every verified Monad NFT collection has one. Anyone signed in can join, for free.",
  },
  {
    icon: <ChatIcon className="size-4" />,
    title: "Take part",
    body: "Post, reply and like on the Club's Board, and enter its challenges. Your wallet signs your posts, so they're yours.",
  },
  {
    icon: <SwapIcon className="size-4" />,
    title: "Trade",
    body: "Swap NFTs, tokens and MON with other members, NFT for NFT or any mix. Both sides move together, or nothing moves.",
  },
  {
    icon: <CoinIcon className="size-4" />,
    title: "Get rewarded",
    body: `Each week ${percent(PROTOCOL.holderBps)} of a Club's swap fees goes to its active Holders, in MON. Its Owner and sponsors can add more, through challenges and sponsored weeks.`,
  },
];

const START_STEPS = [
  {
    title: PRIVY_APP_ID ? "Sign in and link your wallet" : "Connect a wallet",
    body: PRIVY_APP_ID ? (
      <>
        Press <b>Sign in</b> with Google, X, Discord or a wallet, then link the wallet that holds your NFTs on the <b>Account</b> page.
      </>
    ) : (
      <>
        Press <b>Connect wallet</b> and pick the wallet that holds your NFTs.
      </>
    ),
  },
  {
    title: "Show your handle",
    body: (
      <>
        Link an X or Discord account and turn on <b>Show my X or Discord handle</b> on your <b>Profile</b> page. You need it to post.
      </>
    ),
  },
  {
    title: "Join your Club",
    body: (
      <>
        Open it from <b>Clubs</b> and press <b>Join Club</b>. It sends no transaction. To leave, open the <b>⋯</b> menu and choose <b>Leave this Club</b>.
      </>
    ),
  },
  {
    title: "Take part each week",
    body: (
      <>
        Post, reply and like on the <b>Board</b>, and enter challenges. The <b>Rewards</b> tab shows your points and your place as the week goes.
      </>
    ),
  },
];

const TABS = [
  {
    icon: <TagIcon className="size-4" />,
    title: "Market",
    body: (
      <>
        Open deals{swapIntents ? " and signed swaps" : ""} for the asset, split into <b>For trade</b> and <b>Wanted</b>, plus <b>Recent swaps</b>.
      </>
    ),
  },
  {
    icon: <ChatIcon className="size-4" />,
    title: "Board",
    body: (
      <>
        Short posts from members, with replies and likes under them. Order them by a lens: Newest, Most active, Holders or Following. A <i>Looking for</i> post
        can link one of the Club&apos;s own deals.
      </>
    ),
  },
  {
    icon: <TrophyIcon className="size-4" />,
    title: "Challenges",
    body: (
      <>
        Tasks the Owner sets the Club, any time. Answer one with your own X post; the winners get points toward the week&apos;s rewards, a trophy, and sometimes
        an NFT or token. See{" "}
        <a href="#challenges" className="underline">
          Challenges
        </a>
        .
      </>
    ),
  },
  {
    icon: <UsersIcon className="size-4" />,
    title: "Members",
    body: (
      <>
        A leaderboard of the people in the Club, ranked by Momentum. <b>Follow</b> the ones you trust.
      </>
    ),
  },
  {
    icon: <CoinIcon className="size-4" />,
    title: "Rewards",
    body: (
      <>
        What the Club&apos;s swaps paid in fees this epoch, what sponsors added, how much went to its Holders and its Owner, and your share to claim.{" "}
        <b>Share the week</b> posts the recap to X.
      </>
    ),
  },
  {
    icon: <ShieldIcon className="size-4" />,
    title: "Manage",
    body: (
      <>
        For staff. Owners edit the Club page, the coin rule and the X links; everyone on staff sees the bans and the moderation log. Pins and moderators are set
        from the post menus and the Members list.
      </>
    ),
  },
];

const MOMENTUM_RULES = [
  {
    title: "Completed swaps count most",
    body: `${MOMENTUM.swapWeight} points for each side of a finished trade. The same two wallets swapping again within ${MOMENTUM.washDays} days counts ${MOMENTUM.washFactor * 100}%.`,
  },
  { title: "New deals count a little", body: `${MOMENTUM.createdWeight} points each, at most ${MOMENTUM.createdPerDay} a day per wallet.` },
  {
    title: "Your posts count too",
    body: `${MOMENTUM.postWeight} points for a Holder's first Board post of the day, and ${MOMENTUM.xShareWeight} when they share their own X post about the Club on its Board, one a day. An X post that only matches a tag counts half. Replies, and posts that get hidden, count for nothing.`,
  },
  { title: "Everything fades", body: `Points halve every ${MOMENTUM.halfLifeDays} days and are gone after ${MOMENTUM.windowDays}.` },
];

const POST_RULES = [
  "Be a member, link an X or Discord account, and turn on “Show my X or Discord handle” on your Profile page.",
  "Your Club wallet signs each post. It costs no gas and moves nothing, and it makes the post yours: anyone can check it, here or in another app.",
  `Plain text, up to ${POST_MAX} characters. No formatting, and links in the text aren't clickable.`,
  `A note can share one X post, shown as a card. A “Looking for” post can attach a deal${swapIntents ? " or a signed swap" : ""}.`,
  `One post every ${POST_COOLDOWN_SEC} seconds, and ${POSTS_PER_HOUR} an hour in each Club.`,
  "Delete your own posts whenever you like.",
];

const ROLES: ReadonlyArray<{ icon: React.ReactNode; role: string; who: string; can: string }> = [
  {
    icon: <CrownIcon className="size-4" />,
    role: "Owner",
    who: "The wallet the collection's contract names as its owner, once it presses Claim. Or someone the app's admins picked.",
    can: `Edits the description and up to ${MAX_LINKS} links, links the project's X account, sets whether coin holders get the badge, pins up to ${MAX_PINNED} posts, appoints up to ${MAX_MODERATORS} moderators, can limit posting to Holders, collects the Club fund, and can hand the Club to another member.`,
  },
  {
    icon: <ShieldIcon className="size-4" />,
    role: "Moderator",
    who: "Appointed by the Owner.",
    can: "Hides, restores and deletes posts, and bans or unbans members of this Club, but can't lift a ban the Owner made. Can't act on the Owner or other moderators.",
  },
  {
    icon: <UsersIcon className="size-4" />,
    role: "Member",
    who: "Anyone who joined.",
    can: "Posts, replies, likes and reports, follows other members, and appears on the leaderboard.",
  },
  {
    icon: <FlagIcon className="size-4" />,
    role: "Visitor",
    who: "Not signed in, or not joined.",
    can: "Reads everything, but can't post.",
  },
];

/** For an Owner or a sponsor: the ways to put more into a Club than its swap fees do. */
const GROW = [
  {
    icon: <TrophyIcon className="size-4" />,
    title: "Run a challenge",
    body: "Set the Club a task: a meme, a pitch, a name. Winners get points, a trophy, and an NFT or token if you offer one.",
  },
  {
    icon: <CoinIcon className="size-4" />,
    title: "Back a week",
    body: "Anyone can sponsor a week. The MON goes to the Club's Holders, and your name shows on its Rewards tab and in the weekly recap.",
  },
  {
    icon: <ShieldIcon className="size-4" />,
    title: "Choose who is paid",
    body: "Pay every active Holder, only the most active, or set aside a slice for members without NFTs. Changes start next week.",
  },
  {
    icon: <XLogoIcon className="size-4" />,
    title: "Share the week",
    body: "Post the weekly recap to X: the fees, the sponsors and what the most active Holders were paid.",
  },
];

const SPONSOR_STEPS = [
  {
    title: "Open the Club's Rewards tab",
    body: (
      <>
        Press <b>Sponsor this epoch</b>.
      </>
    ),
  },
  { title: "Enter an amount and a name", body: "The name is what the Club sees next to your gift." },
  {
    title: "Send the MON, then sign",
    body: "The app checks the payment on chain before it puts your name on it. The MON is paid to the rewards operator, who adds it to that week's Holder pool, so it can't be refunded.",
  },
];

const PAID_STEPS = [
  {
    title: "Hold an NFT of the collection",
    body: "Each NFT is one share of the Club's payout, added up over your linked wallets. Your holdings are read every day and again when the week closes, and the average counts, so NFTs bought at the end of the week count for little. Without an NFT you're paid only if your Club's Owner turned on a slice for members without NFTs.",
  },
  {
    title: "Be active that week",
    body: `Holding alone earns nothing. Your points decide how much of your share you get: a few points get part of it, and from the Club's threshold (on its Rewards tab) all of it. More points then add a bonus of up to ${percent(PROTOCOL.maxBonusBps)}, the whole of it at ${DEFAULT_CLUB_RULES.fullBonusPoints} points, and a streak adds a little more.`,
  },
  {
    title: "Fit your Club's rules",
    body: "The Owner can pay only the most active Holders (a number or a percentage), change the points for a whole share, and ban a member from rewards. They can also set aside a slice of the pool for members without NFTs, split by their points; it's off unless they turn it on. Changes apply from the next week and are written to the Club's log; every week publishes the rules it used.",
  },
];

const EARN: ReadonlyArray<{ icon: React.ReactNode; title: string; lead: string; more: readonly string[] }> = [
  {
    icon: <HeartIcon className="size-4" />,
    title: "Get backed",
    lead: "When Holders like or reply to your posts and replies, part of their weekly backing goes to you. For most members it's the biggest source of points.",
    more: [
      "Every Holder has backing to give each week: more for more NFTs, up to a limit. A verified X or Discord profile adds a little to give in any Club.",
      "It's shared over everything they like or reply to that week, so backing from someone choosy is worth more than from someone who likes everything.",
      "A reply passes on more than a like, and the first reply on a post the most. Backing not given by the end of the week is lost.",
    ],
  },
  {
    icon: <ChatIcon className="size-4" />,
    title: "Engage with others",
    lead: "Liking and replying earn you points too, not only the people you back.",
    more: [
      "It counts people: each member you reply to or like adds points, a reply more than a like.",
      "Ten likes on one person's posts earn what one does. Talking with more members is what pays.",
      "Capped each week. Members without NFTs earn it too, which pays where the Club has a slice for them.",
    ],
  },
  {
    icon: <FlameIcon className="size-4" />,
    title: "Show up",
    lead: "Each day (UTC) you post, reply or like on the Board is an active day, up to 7 a week.",
    more: [
      `${DEFAULT_CLUB_RULES.streakMinDays} or more active days a week keep a streak going, and each week in a row adds to your bonus, up to a limit.`,
      "A deleted or hidden post doesn't count, and liking the same post again doesn't add a day.",
    ],
  },
  {
    icon: <XLogoIcon className="size-4" />,
    title: "Post about it on X",
    lead: "Share your own X post about the Club in a Board note.",
    more: [
      "From the X account linked to your profile, posted in the last 48 hours. One a day counts in each Club, and each X post counts once.",
      "About the Club means a link to the Club or its token, a mention of or reply to the project's X account, or one of the Club's tags (a tag counts less).",
      "Once X engagement is switched on, posts that do well on X count for more, up to a limit.",
    ],
  },
  {
    icon: <SwapIcon className="size-4" />,
    title: "Trade",
    lead: "Each completed swap with someone else's wallet adds points.",
    more: [
      "Swapping with the same wallet again within a week counts less, and swaps between your own wallets count for nothing.",
      "Capped each week, so trading alone can't carry you.",
    ],
  },
  {
    icon: <TrophyIcon className="size-4" />,
    title: "Win challenges",
    lead: "Winners of the Owner's challenges get the points the Owner set.",
    more: [
      "Wins count as ordinary points for that week, up to a weekly limit.",
      "An entry earns only through its prize: it doesn't count as an active day, an X share or backing for you.",
    ],
  },
];

const days = (ms: number) => Math.round(ms / 86_400_000);

const ENTER_STEPS = [
  { title: "Post it on X", body: "From the X account linked to your profile, after the challenge started. Older posts don't count." },
  {
    title: "Paste the link",
    body: (
      <>
        Open the challenge, paste your post&apos;s link, add a line for the Board and press <b>Sign &amp; enter</b>. It&apos;s shared on the Board too.
      </>
    ),
  },
  {
    title: "Wait for the end",
    body: "One entry each: a new one replaces the old. Some challenges are for Holders only, but anyone in the Club can like the entries.",
  },
];

/** How winners are picked, as a member reads it (`JUDGING`'s lines speak to the Owner). */
const PICK_LINES: Record<Judging, string> = {
  likes: "Ranked by likes from other members. Likes lock when it ends.",
  holders: "The same, but only likes from Holders count.",
  owner: `The Owner picks the winners within ${days(CHALLENGE_RULES.pickWindowMs)} days of the end, or nobody wins.`,
  raffle: "Drawn at random from the entries, using a block nobody could know in advance. The challenge's page shows how to check it.",
  first: "The first entries posted win. If one drops out, the next in line moves up.",
  everyone: "Every entry wins, up to a limit, or only those with the few likes the Owner asked for.",
};
const PICKS = (Object.keys(JUDGING) as Judging[]).map((j) => ({
  icon: <JudgingIcon judging={j} className="size-4" />,
  title: j === "owner" ? "The Owner picks" : JUDGING[j].label,
  body: PICK_LINES[j],
}));

const PRIZES = [
  {
    icon: <CoinIcon className="size-4" />,
    title: "Points",
    body: "Ordinary points for that week, as the Owner set them: more for 1st than 2nd and 3rd, or the same for every winner.",
  },
  { icon: <TrophyIcon className="size-4" />, title: "A trophy", body: "Every winner gets one, on their profile and beside their name in Members." },
  {
    icon: <TagIcon className="size-4" />,
    title: "An NFT or token",
    body: `Sometimes. The Owner sends it from their own wallet and the app checks on chain that it arrived; DeClub never holds it. If it isn't sent within ${days(CHALLENGE_RULES.prizeDueMs)} days, the challenge says Prize not sent.`,
  },
  {
    icon: <PinIcon className="size-4" />,
    title: "A place on top of the Board",
    body: `Sometimes. The Owner can pin the results above the Board's posts for ${days(CHALLENGE_RULES.pinResultsMs)} days.`,
  },
];

const FAIR_PLAY = [
  "Liking or replying to yourself, or between your own wallets.",
  "Members who keep liking each other, or one person over and over.",
  "Swapping with your own wallets, or with the same wallet again and again.",
  "NFTs bought just before the week closes.",
  "Likes taken back and posts a moderator hid. The Owner can also ban a member from rewards.",
  "Paying yourself in fees: each side of a swap pays the full fee and only part of it comes back.",
];

/** Trading, in brief: the Deals guide has every step. */
const TRADE = [
  {
    icon: <ShieldIcon className="size-4" />,
    title: "Nothing can half-happen",
    body: "Both sides move in one transaction, or nothing moves. You never have to trust the other person.",
  },
  swapIntents
    ? {
        icon: <SwapIcon className="size-4" />,
        title: "Lock or just sign",
        body: "Lock your assets in a deal until it's taken, or sign a swap and keep them in your wallet until a match.",
      }
    : {
        icon: <SwapIcon className="size-4" />,
        title: "Any mix of assets",
        body: "Swap NFTs, tokens and MON. Ask for exact assets, any NFT with a trait, or take offers.",
      },
  {
    icon: <CoinIcon className="size-4" />,
    title: "Fees feed the Club",
    body: "A small fee, paid only when a swap completes. Part of it comes back to the Club whose asset was traded.",
  },
];

const SAFETY = [
  "Joining shows your wallet on the Members list. Join with one you're happy to show.",
  "A post or a profile link is written by a member, not checked by DeClub.",
  "A Holder badge or a high Momentum is not an endorsement of the person or the asset.",
  "A deal linked from a post is still just a deal: check every asset before you sign.",
];

const FAQ: ReadonlyArray<[string, string]> = [
  [
    "Does it cost anything to join or post?",
    "No. Joining sends no transaction, and signing a post costs no gas and moves nothing. You need MON only to trade, and a little for gas when you claim rewards.",
  ],
  [
    "Do I need an NFT?",
    "Not to join, post, like or reply, though some Owners limit posting to Holders. To be paid from the Holder pool you need an NFT of the collection, unless the Owner turned on a slice for members without NFTs.",
  ],
  [
    "How are rewards worked out?",
    `Each week, the fees from the Club's completed swaps are added up. ${percent(PROTOCOL.holderBps)} goes to its active Holders, split by the NFTs they held through the week, with a bonus for the most active; ${percent(PROTOCOL.fundBps)} goes to the Owner's Club fund. Whatever can't be paid rolls into the next week.`,
  ],
  [
    "What if my Club has few swaps?",
    "Fees are one source, not the only one. The Owner can run challenges with points, a trophy or an NFT or token, and anyone can sponsor a week to add MON to the Holders' share. Both show on the Club's page.",
  ],
  [
    "Can anyone sponsor a Club?",
    "Yes. Open its Rewards tab, press Sponsor this epoch, enter an amount and a name, send the MON and sign. The app checks the payment on chain. The MON goes to the Club's Holders only and can't be refunded.",
  ],
  [
    "Why haven't I been paid yet?",
    `An epoch is paid after it ends, once it's published on chain, and claims open a day after that (the default), so a mistake can be caught. You also need some activity that week, and an NFT of the collection (unless the Owner turned on a slice for members without NFTs), and to be among the paid places if the Owner limited them. Holding alone doesn't earn a share. Your share waits under Rewards until you claim it.`,
  ],
  [
    "Which assets get a Club?",
    "Only NFT collections on DeClub's verified list, so a copycat can't get one. A memecoin made for a collection shares that collection's Club. The Owner decides whether holding it makes you a Holder, and from how much; rewards follow the NFTs either way. A memecoin has no Club of its own.",
  ],
  [
    "Why can't I post?",
    "You need to be a member, with an X or Discord account linked and “Show my X or Discord handle” turned on (Profile page). Linking alone isn’t enough. Some Owners also limit posting to Holders. If you posted a moment ago, wait for the cooldown.",
  ],
  [
    "Can I take my posts with me?",
    "Yes. Every post is signed by your wallet, and each Club's feed is public at /api/clubs/<address>/feed, with the signature. Your posts across Clubs are at /api/wallets/<your wallet>/posts, and who you follow at /api/wallets/<your wallet>/follows.",
  ],
  [
    "Does a Club change how my deals work?",
    "No. A deal works the same whether or not you're in a Club, and leaving one doesn't touch your deals. What changes is where the fee goes afterwards: part of it comes back to the Club whose asset was traded.",
  ],
  [
    "Do challenge entries earn points on their own?",
    "No. An entry still adds to the Club's Momentum, but what it earns you is the challenge's prize. It doesn't count as an active day, an X share or backing from its likes, even after you withdraw it, unless the Owner cancels the challenge. Liking and replying to entries still counts as engaging.",
  ],
  [
    "Who sends an NFT or token prize?",
    `The Owner, from their own wallet, after the challenge ends. They paste the transaction and the app checks on chain that it reached the winner. DeClub never holds the prize and can't send it for them. If it isn't sent within ${days(CHALLENGE_RULES.prizeDueMs)} days, the challenge says so, and the Owner can't offer another in that Club until they send it.`,
  ],
  [
    "How does someone become the Owner?",
    "The wallet that the collection's contract names as its owner presses Claim on the Club page. The app's admins can also pick an Owner.",
  ],
  [
    "What happens if I'm banned?",
    "You leave the Club, lose any role, and can't rejoin or post there. The app's admins can ban someone from every Club. Staff actions are written to a log that only staff can read.",
  ],
];

export const metadata: Metadata = { title: "Guide" };

export default function GuidePage() {
  return (
    <div className="space-y-10 pb-10">
      <GuideHero
        base="clubs"
        title="How DeClub works,"
        accent="in three minutes."
        lead="Join your collection's Club, trade and talk inside it, and share in the fees its swaps pay. What matters most comes first."
        actions={
          <>
            <Link href="/clubs" className="btn-primary">
              Explore Clubs <span aria-hidden>→</span>
            </Link>
            <Link href="/guide/deals" className="btn-secondary">
              How deals work
            </Link>
          </>
        }
        summary={[
          "Joining a Club is free.",
          `Active Holders share ${percent(PROTOCOL.holderBps)} of its fees, every week.`,
          "Owners and sponsors can add more with challenges and sponsored weeks.",
          "Swaps move both sides together, or nothing.",
          "Your posts are signed and yours.",
          NETWORK.mainnet ? "Real assets: check every deal." : "Testnet only: use test assets.",
        ]}
        sections={SECTIONS}
      />

      <GuideBody sections={SECTIONS}>
        <Section sections={SECTIONS} id="what" title="Your collection's Club, owned by its members">
          <CardGrid cols={2} items={PILLARS} />
          <p className="mt-4 flex items-start gap-2.5 rounded-xl border-2 border-dashed border-[#111318]/30 p-4 text-sm leading-6">
            <CoinIcon className="mt-0.5 size-5 shrink-0 text-[#1f7a55]" />
            <span>
              <b>To be paid, hold an NFT of the collection and be active that week.</b> Holding alone earns nothing, and the more you take part, the bigger your
              share.
            </span>
          </p>
        </Section>

        <Section sections={SECTIONS} id="start" title="Start in four steps">
          <Steps items={START_STEPS} />
          <p className="mt-4 flex items-start gap-2.5 rounded-xl border-2 border-dashed border-[#111318]/30 p-4 text-sm leading-6">
            <UsersIcon className="mt-0.5 size-5 shrink-0 text-[#a9282f]" />
            <span>
              <b>Joining shows your wallet</b> on the Members list, so join with an account whose wallet you&apos;re happy to show.
              {!PRIVY_APP_ID && " Sign-in is off on this deployment, so joining and posting aren't available here."} You need{" "}
              {NETWORK.mainnet ? "MON" : "test MON"} only to trade, and a little for gas when you claim
              {NETWORK.mainnet ? (
                ""
              ) : (
                <>
                  ; get some from the{" "}
                  <a href="https://faucet.monad.xyz" target="_blank" rel="noreferrer" className="font-bold underline">
                    Monad faucet
                  </a>
                </>
              )}
              . The bell in the header tells you about replies, likes, rewards, your rank and challenges.
            </span>
          </p>
        </Section>

        <Section
          sections={SECTIONS}
          id="trade"
          title="Trade inside the Club"
          intro={
            <>
              A Club&apos;s <b>Market</b> tab lists its open deals{swapIntents ? " and signed swaps" : ""}. Every trade goes wallet to wallet through a
              contract.
            </>
          }
        >
          <CardGrid items={TRADE} />
          <Link href="/guide/deals" className="btn-secondary mt-4">
            How deals work, step by step <span aria-hidden>→</span>
          </Link>
        </Section>

        <Section sections={SECTIONS} id="rewards" title="Rewards: the Club shares in its market">
          <h3 className="text-lg font-black">Who gets paid</h3>
          <div className="mt-3">
            <Steps items={PAID_STEPS} />
          </div>

          <h3 className="mt-8 text-lg font-black">How you earn points</h3>
          <p className={`mt-1 mb-3 text-sm leading-6 ${MUTED}`}>
            Points add up over the week. Your Rewards tab shows yours, where they came from, and your place.
          </p>
          <ul className="grid gap-4 md:grid-cols-2">
            {EARN.map((item) => (
              <li key={item.title} className={`${CARD} p-5`}>
                <div className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-[#111318] bg-peach">{item.icon}</span>
                  <h4 className="font-black">{item.title}</h4>
                </div>
                <p className="mt-3 text-sm leading-6">{item.lead}</p>
                <ul className={`mt-2 space-y-1.5 text-sm leading-6 ${MUTED}`}>
                  {item.more.map((line) => (
                    <li key={line} className="flex gap-2.5">
                      <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-[#111318]" />
                      {line}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className={`${CARD} p-5 sm:p-6`}>
              <span className="grid size-9 place-items-center rounded-full border-2 border-[#111318] bg-mint">
                <CoinIcon className="size-4" />
              </span>
              <h3 className="mt-4 text-lg font-black">Where the fee goes</h3>
              <p className={`mt-1.5 text-sm leading-6 ${MUTED}`}>
                Every completed swap pays a small fee for each NFT on each side. Each week, for each Club whose asset was traded:
              </p>
              <ul className="mt-3 space-y-1.5 text-sm">
                <li>
                  <b>{percent(PROTOCOL.holderBps)}</b> to the Club&apos;s active Holders, split by the NFTs they held, up to {percent(PROTOCOL.maxBonusBps)}{" "}
                  more for the most active
                </li>
                <li>
                  <b>{percent(PROTOCOL.fundBps)}</b> to the Club fund, claimed by the Owner
                </li>
                <li>
                  <b>{percent(PROTOCOL.protocolBps)}</b> stays with the protocol
                </li>
              </ul>
              <p className={`mt-3 text-sm leading-6 ${MUTED}`}>A swap that names two Clubs&apos; assets splits its fee between them.</p>
              <p className={`mt-3 text-sm leading-6 ${MUTED}`}>
                Fees aren&apos;t the only source: sponsors can add MON to the Holders&apos; share for a week.{" "}
                <a href="#grow" className="underline">
                  Grow a Club
                </a>
                .
              </p>
            </div>
            <div className={`${CARD} p-5 sm:p-6`}>
              <span className="grid size-9 place-items-center rounded-full border-2 border-[#111318] bg-peach">
                <CrownIcon className="size-4" />
              </span>
              <h3 className="mt-4 text-lg font-black">Claiming</h3>
              <p className={`mt-1.5 text-sm leading-6 ${MUTED}`}>
                Your share is paid to your Club wallet in MON. After an epoch is published, claims open a day later (the default delay); then press
                <b className="text-[#111318]"> Claim</b> on a Club&apos;s <b className="text-[#111318]">Rewards</b> tab or on your Account settings. One claim
                collects every open epoch.
              </p>
              <p className={`mt-3 text-sm leading-6 ${MUTED}`}>Every epoch&apos;s numbers and proofs are public, so anyone can check who was paid what.</p>
              <p className={`mt-3 text-sm leading-6 ${MUTED}`}>
                Claim in time: once the claim window closes (90 days unless the deployment sets another), the operator can sweep what is left.
              </p>
            </div>
          </div>

          <h3 className="mt-8 text-lg font-black">Fair play</h3>
          <p className={`mt-1 mb-3 text-sm leading-6 ${MUTED}`}>Points are meant for real activity, so these earn little or nothing:</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {FAIR_PLAY.map((line) => (
              <li key={line} className={`${CARD} flex gap-3 p-4 text-sm leading-6`}>
                <span className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-[#111318] bg-peach">
                  <CrossIcon className="size-3" />
                </span>
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-6 text-muted">
            Points are checked again when the week closes, so the estimate can change. After that, who liked and replied to whom is published with the
            week&apos;s payouts, so anyone can check them.
          </p>
          <p className="mt-4 flex items-start gap-2.5 rounded-xl border-2 border-dashed border-[#111318]/30 p-4 text-sm leading-6">
            <ListIcon className="mt-0.5 size-5 shrink-0" />
            <span>
              Want the rules in one place?{" "}
              <Link href="#rewards" className="font-semibold underline underline-offset-2">
                Read how points, limits and payouts work in this Rewards section.
              </Link>
            </span>
          </p>
        </Section>

        <Section
          sections={SECTIONS}
          id="challenges"
          title="Challenges: post, win, get a trophy"
          intro={
            <>
              The Owner sets the Club a task, any time: a meme, a pitch, a name. It shows as a card on the Board and the <b>Challenges</b> tab, and ends when a
              week does.
            </>
          }
        >
          <h3 className="text-lg font-black">Enter in three steps</h3>
          <div className="mt-3">
            <Steps items={ENTER_STEPS} />
          </div>

          <h3 className="mt-8 text-lg font-black">How winners are picked</h3>
          <p className={`mt-1 mb-3 text-sm leading-6 ${MUTED}`}>The Owner chooses one when they start it; the card says which.</p>
          <CardGrid cols={3} items={PICKS} />

          <h3 className="mt-8 text-lg font-black">What winners get</h3>
          <div className="mt-3">
            <CardGrid cols={2} items={PRIZES} />
          </div>

          <p className="mt-4 flex items-start gap-2.5 rounded-xl border-2 border-dashed border-[#111318]/30 p-4 text-sm leading-6">
            <TrophyIcon className="mt-0.5 size-5 shrink-0 text-[#a9282f]" />
            <span>
              <b>Your entry earns through its prize.</b> It still adds to the Club&apos;s Momentum, but it doesn&apos;t count as an active day, an X share or
              backing for you, even after you withdraw it. Liking and replying to entries still counts as engaging. Won? <b>Share your win</b> on the
              challenge&apos;s page; the bell tells you about new challenges, their last day and results.
            </span>
          </p>
        </Section>

        <Section sections={SECTIONS} id="post" title="Post and report">
          <div className="grid gap-4 md:grid-cols-2">
            <div className={`${CARD} p-5 sm:p-6`}>
              <h3 className="flex items-center gap-2 font-black">
                <ChatIcon className="size-4" /> Posting
              </h3>
              <ul className={`mt-3 space-y-2.5 text-sm leading-6 ${MUTED}`}>
                {POST_RULES.map((rule) => (
                  <li key={rule} className="flex gap-2.5">
                    <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-[#111318]" />
                    {rule}
                  </li>
                ))}
              </ul>
            </div>
            <div className={`${CARD} p-5 sm:p-6`}>
              <h3 className="flex items-center gap-2 font-black">
                <FlagIcon className="size-4" /> Reporting
              </h3>
              <p className={`mt-3 text-sm leading-6 ${MUTED}`}>
                Report a post that&apos;s spam or abuse, once per post and never your own. Every report goes to the Club&apos;s Moderators, who see it in the
                Reported list on the Manage tab. A report alone hides nothing: a hidden post&apos;s backing counts for nothing, so only a Moderator (or the
                Owner) can hide one, and the points a hide removes are published after the epoch.
              </p>
              <p className={`mt-3 text-sm leading-6 ${MUTED}`}>The moderator then hides it, deletes it, or dismisses the reports.</p>
            </div>
          </div>
          <div className={`${CARD} mt-4 p-5 sm:p-6`}>
            <h3 className="flex items-center gap-2 font-black">
              <BadgeCheckIcon className="size-4" /> Choose how the Board is ordered
            </h3>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              {LENSES.map((lens) => (
                <div key={lens.id}>
                  <dt className="text-sm font-black">{lens.name}</dt>
                  <dd className={`text-sm leading-6 ${MUTED}`}>{lens.description}</dd>
                </div>
              ))}
            </dl>
            <p className={`mt-3 text-sm leading-6 ${MUTED}`}>
              Because posts and follows are public and signed, any other app can order the same Board its own way.
            </p>
          </div>
        </Section>

        <Section
          sections={SECTIONS}
          id="club"
          title="Inside a Club"
          intro={
            <>
              Open <b>Clubs</b> in the header to see them all, busiest first. Each Club has these tabs.
            </>
          }
        >
          <CardGrid cols={2} items={TABS} />

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className={`${CARD} p-5 sm:p-6`}>
              <span className="grid size-9 place-items-center rounded-full border-2 border-[#111318] bg-mint">
                <ShieldIcon className="size-4" />
              </span>
              <h3 className="mt-4 text-lg font-black">Holder badge</h3>
              <p className={`mt-1.5 text-sm leading-6 ${MUTED}`}>
                Members whose linked wallets hold the asset get a <b className="text-[#111318]">Holder</b> badge: any NFT of the collection. When the Club has a
                memecoin, its Owner can let coin holders earn the badge too, from a minimum they set. Only NFTs earn reward shares.
              </p>
              <p className={`mt-3 text-sm leading-6 ${MUTED}`}>
                It shows what they held at the last check, which runs about once a day. It gives no extra powers, unless the Owner limits posting to Holders.
              </p>
            </div>
            <div className={`${CARD} p-5 sm:p-6`}>
              <span className="grid size-9 place-items-center rounded-full border-2 border-[#111318] bg-peach">
                <FlameIcon className="size-4" />
              </span>
              <h3 className="mt-4 text-lg font-black">Momentum</h3>
              <p className={`mt-1.5 text-sm leading-6 ${MUTED}`}>
                A score for how busy a market has been lately. It ranks Clubs on the Clubs page, with an arrow for the change since last week, and ranks members
                inside their Club.
              </p>
              <dl className="mt-4 space-y-3 border-t border-[#111318]/10 pt-4">
                {MOMENTUM_RULES.map((rule) => (
                  <div key={rule.title}>
                    <dt className="text-sm font-black">{rule.title}</dt>
                    <dd className={`text-sm leading-6 ${MUTED}`}>{rule.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted">
            Momentum says &ldquo;this market has been busy&rdquo;, not that an asset is good or safe, or that a member is honest. On your Profile page you can
            set an avatar from an NFT you hold.
          </p>
        </Section>

        <Section sections={SECTIONS} id="roles" title="Who runs a Club">
          <dl className={`${CARD} divide-y divide-[#111318]/10`}>
            {ROLES.map(({ icon, role, who, can }) => (
              <div key={role} className="grid gap-3 p-5 sm:grid-cols-[10rem_1fr] sm:gap-6 sm:p-6">
                <dt className="flex items-center gap-2.5 font-black">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-[#111318] bg-peach">{icon}</span>
                  {role}
                </dt>
                <dd className="text-sm leading-6">
                  <p className={MUTED}>{who}</p>
                  <p className="mt-1">{can}</p>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm leading-6 text-muted">The app&apos;s admins can do all of this in every Club, and ban someone from all of them.</p>
        </Section>

        <Section
          sections={SECTIONS}
          id="grow"
          title="Grow a Club: challenges and sponsors"
          intro={<>Swap fees are one source of rewards. An Owner or a sponsor can put more in any week, and the Club shows who did.</>}
        >
          <CardGrid cols={2} items={GROW} />

          <h3 className="mt-8 text-lg font-black">Sponsor a week</h3>
          <div className="mt-3">
            <Steps items={SPONSOR_STEPS} />
          </div>
          <p className="mt-4 flex items-start gap-2.5 rounded-xl border-2 border-dashed border-[#111318]/30 p-4 text-sm leading-6">
            <CoinIcon className="mt-0.5 size-5 shrink-0 text-[#1f7a55]" />
            <span>
              <b>Sponsored MON goes to Holders only.</b> None of it goes to the Club fund or the protocol, and a week with no Holders carries it to the next.
              Pick a Club with real members: the pool pays whoever is active in it.
            </span>
          </p>
          <Link href="#challenges" className="btn-secondary mt-4">
            How challenges work <span aria-hidden>→</span>
          </Link>
        </Section>

        <GuideEnd
          sections={SECTIONS}
          safetyTitle="Stay safe in Clubs"
          safety={SAFETY}
          faq={FAQ}
          other={{ href: "/guide/deals", title: "Deals guide", body: "Make a deal, take one, and get your assets back if it doesn't happen." }}
        />
      </GuideBody>
    </div>
  );
}
