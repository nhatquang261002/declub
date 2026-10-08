import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheckIcon, ChatIcon, CoinIcon, CrossIcon, CrownIcon, ExternalIcon, FlagIcon, FlameIcon, HeartIcon, ListIcon, ShieldIcon, SwapIcon, TagIcon, TrophyIcon, UsersIcon, XLogoIcon } from "@/components/Icons";
import { MAX_MODERATORS } from "@/lib/clubRoles";
import { MAX_LINKS, MAX_PINNED, POST_COOLDOWN_SEC, POST_MAX, POSTS_PER_HOUR } from "@/lib/clubPosts";
import { PRIVY_APP_ID, REWARDS_RULES_URL } from "@/lib/config";
import { swapIntents } from "@/lib/contracts";
import { LENSES } from "@/lib/lenses";
import { MOMENTUM } from "@/lib/momentum";
import { DEFAULT_CLUB_RULES, PROTOCOL, percent } from "@/lib/rewards";
import { CARD, CardGrid, Checklist, Faq, GuideBody, GuideFooter, GuideHero, MUTED, Section, type GuideSection } from "../parts";

// The Clubs guide, beside the Deals guide at /guide. The numbers come from the same constants the server enforces, so the
// page can't drift from the rules. The longer version is the Clubs section of docs/07-user-guide.md.

const SECTIONS: GuideSection[] = [
  { id: "what", label: "What a Club is" },
  { id: "join", label: "Join a Club" },
  { id: "badges", label: "Badges and Momentum" },
  { id: "rewards", label: "Rewards" },
  { id: "post", label: "Post and report" },
  { id: "roles", label: "Who runs a Club" },
  { id: "safety", label: "Stay safe" },
  { id: "faq", label: "FAQ" },
];

const TABS = [
  { icon: <TagIcon className="size-4" />, title: "Market", body: <>Open deals{swapIntents ? " and signed swaps" : ""} for the asset, split into <b>For trade</b> and <b>Wanted</b>, plus <b>Recent swaps</b>.</> },
  { icon: <ChatIcon className="size-4" />, title: "Board", body: <>Short posts from members, with replies and likes under them. Order them by a lens: Newest, Most active, Holders or Following. A <i>Looking for</i> post can link one of the Club&apos;s own deals.</> },
  { icon: <TrophyIcon className="size-4" />, title: "Challenges", body: <>Tasks the Owner sets the Club, any time. Answer one with a post; the winners, picked by likes or by the Owner, earn activity points for the week, which raise your share of the rewards.</> },
  { icon: <UsersIcon className="size-4" />, title: "Members", body: <>A leaderboard of the people in the Club, ranked by Momentum. <b>Follow</b> the ones you trust.</> },
  { icon: <CoinIcon className="size-4" />, title: "Rewards", body: <>What the Club&apos;s swaps paid in fees this epoch, how much went to its Holders and its Owner, and your share to claim. <b>Share the week</b> posts the recap to X.</> },
  { icon: <ShieldIcon className="size-4" />, title: "Manage", body: <>For staff. Owners edit the Club page, the coin rule and the X links; everyone on staff sees the bans and the moderation log. Pins and moderators are set from the post menus and the Members list.</> },
];

const JOIN_STEPS = [
  { title: "Sign in and link a wallet", body: <>Press <b>Sign in</b>, then link the wallet you trade with on the <b>Account</b> page.</> },
  { title: "Press Join Club", body: <>Open the Club from <b>Clubs</b> and press <b>Join Club</b>. Anyone signed in can join. To leave, open the <b>⋯</b> menu and choose <b>Leave this Club</b>; that takes you off the Members list again.</> },
];

const MOMENTUM_RULES = [
  { title: "Completed swaps count most", body: `${MOMENTUM.swapWeight} points for each side of a finished trade. The same two wallets swapping again within ${MOMENTUM.washDays} days counts ${MOMENTUM.washFactor * 100}%.` },
  { title: "New deals count a little", body: `${MOMENTUM.createdWeight} points each, at most ${MOMENTUM.createdPerDay} a day per wallet.` },
  {
    title: "Your X posts count too",
    body: `${MOMENTUM.xShareWeight} points when a Holder shares their own X post about the Club on its Board, one a day. A post that only matches a tag counts half. Board notes count for nothing.`,
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
    more: ["Swapping with the same wallet again within a week counts less, and swaps between your own wallets count for nothing.", "Capped each week, so trading alone can't carry you."],
  },
  {
    icon: <TrophyIcon className="size-4" />,
    title: "Win challenges",
    lead: "The Owner sets challenges with points for up to three places.",
    more: ["Winners are picked by members' likes or by the Owner.", "Wins count as ordinary points for that week, up to a weekly limit."],
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

const SAFETY = [
  "Joining shows your wallet on the Members list. Join with one you're happy to show.",
  "A post or a profile link is written by a member, not checked by DeClub.",
  "A Holder badge or a high Momentum is not an endorsement of the person or the asset.",
  "A deal linked from a post is still just a deal: check every asset before you sign.",
];

const FAQ: ReadonlyArray<[string, string]> = [
  ["Does a Club change how my deals work?", "No. A deal works the same whether or not you're in a Club, and leaving one doesn't touch your deals. What changes is where the fee goes afterwards: part of it comes back to the Club whose asset was traded."],
  [
    "How are rewards worked out?",
    `Each week, the fees from the Club's completed swaps are added up. ${percent(PROTOCOL.holderBps)} goes to its active Holders, split by the NFTs they held through the week, with a bonus for the most active; ${percent(PROTOCOL.fundBps)} goes to the Owner's Club fund. Whatever can't be paid rolls into the next week.`,
  ],
  ["Why haven't I been paid yet?", `An epoch is paid after it ends, once it's published on chain, and claims open a day after that (the default), so a mistake can be caught. You also need some activity that week, and an NFT of the collection (unless the Owner turned on a slice for members without NFTs), and to be among the paid places if the Owner limited them. Holding alone doesn't earn a share. Your share waits under Rewards until you claim it.`],
  ["Can I take my posts with me?", "Yes. Every post is signed by your wallet, and each Club's feed is public at /api/clubs/<address>/feed, with the signature. Your posts across Clubs are at /api/wallets/<your wallet>/posts, and who you follow at /api/wallets/<your wallet>/follows."],
  ["Which assets get a Club?", "Only NFT collections on DeClub's verified list, so a copycat can't get one. A memecoin made for a collection shares that collection's Club. The Owner decides whether holding it makes you a Holder, and from how much; rewards follow the NFTs either way. A memecoin has no Club of its own."],
  ["Why can't I post?", "You need to be a member, with an X or Discord account linked and “Show my X or Discord handle” turned on (Profile page). Linking alone isn’t enough. Some Owners also limit posting to Holders. If you posted a moment ago, wait for the cooldown."],
  ["How does someone become the Owner?", "The wallet that the collection's contract names as its owner presses Claim on the Club page. The app's admins can also pick an Owner."],
  ["What happens if I'm banned?", "You leave the Club, lose any role, and can't rejoin or post there. The app's admins can ban someone from every Club. Staff actions are written to a log that only staff can read."],
];

export const metadata: Metadata = { title: "Clubs guide" };

export default function ClubsGuidePage() {
  return (
    <div className="space-y-10 pb-10">
      <GuideHero
        base="clubs"
        title="How Clubs work,"
        accent="in three minutes."
        lead="Every verified NFT collection has a Club: its market, a board for posts, the people who trade it, and a share of the fees its swaps pay."
        actions={
          <Link href="/clubs" className="btn-primary">
            Explore Clubs <span aria-hidden>→</span>
          </Link>
        }
        summary={["Anyone signed in can join.", `Active Holders share ${percent(PROTOCOL.holderBps)} of the fees.`, "Your posts are signed and yours."]}
        sections={SECTIONS}
      />

      <GuideBody sections={SECTIONS}>
        <Section
          sections={SECTIONS}
          id="what"
          title="A home for each asset"
          intro={<>Open <b>Clubs</b> in the header to see them all, busiest first. Each Club has these tabs.</>}
        >
          <CardGrid cols={2} items={TABS} />
        </Section>

        <Section sections={SECTIONS} id="join" title="Join in two steps">
          <ol className={`${CARD} divide-y divide-[#111318]/10`}>
            {JOIN_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4 p-5 sm:p-6">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-[#111318] bg-accent text-sm font-black text-white">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-black">{step.title}</h3>
                  <p className={`mt-1 text-sm leading-6 ${MUTED}`}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 flex items-start gap-2.5 rounded-xl border-2 border-dashed border-[#111318]/30 p-4 text-sm leading-6">
            <UsersIcon className="mt-0.5 size-5 shrink-0 text-[#a9282f]" />
            <span>
              <b>Joining shows your wallet</b> on the Members list, so join with an account whose wallet you&apos;re happy
              to show.{!PRIVY_APP_ID && " Sign-in is off on this deployment, so joining and posting aren't available here."} Your <b>Club wallet</b> is
              the linked wallet shown next to your name on the Members list. The bell in the header tells you about replies, likes, pins, counted X posts,
              rewards and your rank, and on your Profile page you can set an avatar from an NFT you hold.
            </span>
          </p>
        </Section>

        <Section sections={SECTIONS} id="badges" title="Holder badges and Momentum">
          <div className="grid gap-4 md:grid-cols-2">
            <div className={`${CARD} p-5 sm:p-6`}>
              <span className="grid size-9 place-items-center rounded-full border-2 border-[#111318] bg-mint">
                <ShieldIcon className="size-4" />
              </span>
              <h3 className="mt-4 text-lg font-black">Holder badge</h3>
              <p className={`mt-1.5 text-sm leading-6 ${MUTED}`}>
                Members whose linked wallets hold the asset get a <b className="text-[#111318]">Holder</b> badge: any NFT of
                the collection. When the Club has a memecoin, its Owner can let coin holders earn the badge too, from a minimum they set. Only NFTs earn reward shares.
              </p>
              <p className={`mt-3 text-sm leading-6 ${MUTED}`}>
                It shows what they held at the last check, which runs about once a day. It gives no extra powers, unless
                the Owner limits posting to Holders.
              </p>
            </div>
            <div className={`${CARD} p-5 sm:p-6`}>
              <span className="grid size-9 place-items-center rounded-full border-2 border-[#111318] bg-peach">
                <FlameIcon className="size-4" />
              </span>
              <h3 className="mt-4 text-lg font-black">Momentum</h3>
              <p className={`mt-1.5 text-sm leading-6 ${MUTED}`}>
                A score for how busy a market has been lately. It ranks Clubs on the Clubs page, with an arrow for the
                change since last week, and ranks members inside their Club.
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
            Momentum says &ldquo;this market has been busy&rdquo;, not that an asset is good or safe, or that a member is
            honest.
          </p>
        </Section>

        <Section sections={SECTIONS} id="rewards" title="Rewards: the Club shares in its market">
          <div className="grid gap-4 md:grid-cols-2">
            <div className={`${CARD} p-5 sm:p-6`}>
              <span className="grid size-9 place-items-center rounded-full border-2 border-[#111318] bg-mint">
                <CoinIcon className="size-4" />
              </span>
              <h3 className="mt-4 text-lg font-black">Where the fee goes</h3>
              <p className={`mt-1.5 text-sm leading-6 ${MUTED}`}>
                Every completed swap pays a small fee for each NFT on each side. Each week, for each Club whose asset was traded:
              </p>
              <ul className="mt-3 space-y-1.5 text-sm">
                <li><b>{percent(PROTOCOL.holderBps)}</b> to the Club&apos;s active Holders, split by the NFTs they held, up to {percent(PROTOCOL.maxBonusBps)} more for the most active</li>
                <li><b>{percent(PROTOCOL.fundBps)}</b> to the Club fund, claimed by the Owner</li>
                <li><b>{percent(PROTOCOL.protocolBps)}</b> stays with the protocol</li>
              </ul>
              <p className={`mt-3 text-sm leading-6 ${MUTED}`}>A swap that names two Clubs&apos; assets splits its fee between them.</p>
            </div>
            <div className={`${CARD} p-5 sm:p-6`}>
              <span className="grid size-9 place-items-center rounded-full border-2 border-[#111318] bg-peach">
                <CrownIcon className="size-4" />
              </span>
              <h3 className="mt-4 text-lg font-black">Claiming</h3>
              <p className={`mt-1.5 text-sm leading-6 ${MUTED}`}>
                Your share is paid to your Club wallet in MON. After an epoch is published, claims open a day later (the default delay); then press
                <b className="text-[#111318]"> Claim</b> on a Club&apos;s <b className="text-[#111318]">Rewards</b> tab or on
                your Account settings. One claim collects every open epoch.
              </p>
              <p className={`mt-3 text-sm leading-6 ${MUTED}`}>
                Every epoch&apos;s numbers and proofs are public, so anyone can check who was paid what.
              </p>
              <p className={`mt-3 text-sm leading-6 ${MUTED}`}>
                Claim in time: once the claim window closes (90 days unless the deployment sets another), the operator can sweep what is left.
              </p>
            </div>
          </div>
          <h3 className="mt-8 text-lg font-black">Who gets paid</h3>
          <ol className={`${CARD} mt-3 divide-y divide-[#111318]/10`}>
            {PAID_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4 p-5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-[#111318] bg-accent text-sm font-black text-white">{i + 1}</span>
                <div>
                  <p className="font-black">{step.title}</p>
                  <p className={`mt-1 text-sm leading-6 ${MUTED}`}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <h3 className="mt-8 text-lg font-black">How you earn points</h3>
          <p className={`mt-1 mb-3 text-sm leading-6 ${MUTED}`}>Points add up over the week. Your Rewards tab shows yours, where they came from, and your place.</p>
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
              Want every detail? The full rules, with each weight, limit and formula, are in our docs:{" "}
              <a href={REWARDS_RULES_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                Club Rewards, fully explained <ExternalIcon className="size-3.5" />
              </a>
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
                Report a post that&apos;s spam or abuse, once per post and never your own. Every report goes to the Club&apos;s
                Moderators, who see it in the Reported list on the Manage tab. A report alone hides nothing: a hidden post&apos;s
                backing counts for nothing, so only a Moderator (or the Owner) can hide one, and the points a hide removes are published after the epoch.
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
          <p className="mt-4 text-sm leading-6 text-muted">
            The app&apos;s admins can do all of this in every Club, and ban someone from all of them.
          </p>
        </Section>

        <Section sections={SECTIONS} id="safety" title="Stay safe in Clubs">
          <Checklist items={SAFETY} />
        </Section>

        <Section sections={SECTIONS} id="faq" title="Questions, answered">
          <Faq items={FAQ} />
        </Section>

        <GuideFooter other={{ href: "/guide", title: "Deals guide", body: "Make a deal, take one, and get your assets back if it doesn't happen." }} />
      </GuideBody>
    </div>
  );
}
