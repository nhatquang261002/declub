import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheckIcon, ChatIcon, CoinIcon, CrownIcon, FlagIcon, FlameIcon, ShieldIcon, TagIcon, TrophyIcon, UsersIcon, XLogoIcon } from "@/components/Icons";
import { CHALLENGE_CAP_PER_EPOCH } from "@/lib/challenges";
import { MAX_MODERATORS } from "@/lib/clubRoles";
import { MAX_LINKS, MAX_PINNED, POST_COOLDOWN_SEC, POST_MAX, POSTS_PER_HOUR } from "@/lib/clubPosts";
import { PRIVY_APP_ID } from "@/lib/config";
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
  { icon: <TrophyIcon className="size-4" />, title: "Challenges", body: <>Tasks the Owner sets the Club, any time. Answer one with a post; the winners, picked by likes or by the Owner, earn activity points for the week (at most {CHALLENGE_CAP_PER_EPOCH} count for you), which raise your share of the rewards.</> },
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

const SAFETY = [
  "Joining shows your wallet on the Members list. Join with one you're happy to show.",
  "A post or a profile link is written by a member, not checked by DeClub.",
  "A Holder badge or a high Momentum is not an endorsement of the person or the asset.",
  "A deal linked from a post is still just a deal: check every asset before you sign.",
];

const FAQ: ReadonlyArray<[string, string]> = [
  ["Does a Club change how my deals work?", "No. A deal works the same whether or not you're in a Club, and leaving one doesn't touch your deals. What changes is where the fee goes afterwards: part of it comes back to the Club whose asset was traded."],
  ["How are rewards worked out?", `Each epoch (one week, Monday to Monday UTC), the fees from the Club's completed swaps are added up. ${percent(PROTOCOL.holderBps)} is split between its active Holders: members who hold at least one NFT of the collection when the epoch is built and earned points that epoch, most of them from other people backing their posts and replies, the rest from active days, sharing on X and swapping. Each one's share is the NFTs they held on average over the week, counted in full from ${DEFAULT_CLUB_RULES.rampPoints} points (by default), plus up to the activity bonus. The Owner can limit it to the most active Holders (a number or a percentage), give members without NFTs a slice, and ban a member from rewards; ${percent(PROTOCOL.fundBps)} goes to the Owner's Club fund. Whatever can't be paid (no Holders yet, no Owner) rolls into the next epoch.`],
  ["Why haven't I been paid yet?", `An epoch is paid after it ends, once it's published on chain, and claims open a day after that (the default), so a mistake can be caught. You also have to be a member holding an NFT of the collection, and have some activity points (and be among the paid places, if the Owner limited them) when the epoch is built. Holding alone doesn't earn a share: you need some activity that epoch. Your share waits under Rewards until you claim it.`],
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
          <div className={`${CARD} mt-4 p-5 sm:p-6`}>
            <h3 className="flex items-center gap-2 font-black">
              <XLogoIcon className="size-4" />
              The activity bonus
            </h3>
            <p className={`mt-1.5 text-sm leading-6 ${MUTED}`}>
              You have to hold an NFT of the collection to be paid, and every Holder with activity that week is paid (by default): a payout is split by one share per NFT,
              counted in full from <b className="text-[#111318]">{DEFAULT_CLUB_RULES.rampPoints} points</b> and in part below (half at half the points), so there is no cliff to game. Those shares count up to{" "}
              <b className="text-[#111318]">{percent(PROTOCOL.maxBonusBps)} more</b> for their points. Most points come from other people:
              each Holder has a weekly <b className="text-[#111318]">voice</b> of {DEFAULT_CLUB_RULES.voicePerNft} points per NFT (counting up to {DEFAULT_CLUB_RULES.voiceCapNfts}) in their own Club,
              and every verified account (a shared X or Discord profile) has {PROTOCOL.baseVoice} more to spend on any Club&apos;s Board. A voice is shared out over the posts and
              replies its owner likes or answers that week, and what your posts and replies receive is your <b className="text-[#111318]">backing</b>. On top of that,
              each active day earns {DEFAULT_CLUB_RULES.dayPoints}, each of your own X posts about the Club shared on its Board {PROTOCOL.xShareBase}, and each completed swap with another
              wallet {DEFAULT_CLUB_RULES.swapPoints} (half for a wallet you already swapped with in the last {MOMENTUM.washDays} days, up to {DEFAULT_CLUB_RULES.swapCapPerEpoch} an epoch).{" "}
              {DEFAULT_CLUB_RULES.fullBonusPoints} points earn the full bonus. A Holder who does nothing in an epoch isn&apos;t paid for it, however many NFTs they hold.
            </p>
            <ul className={`mt-3 space-y-1.5 text-sm leading-6 ${MUTED}`}>
              <li>
                <b className="text-[#111318]">Backing:</b> a like weighs {DEFAULT_CLUB_RULES.likeWeight}, a reply {DEFAULT_CLUB_RULES.replyWeight}, and the first reply on a post{" "}
                {DEFAULT_CLUB_RULES.firstReplyWeight}, so a Holder who backs one post gives it their whole voice and one who likes fifty gives each a little. Voice not given in a
                week is lost. A verified account&apos;s {PROTOCOL.baseVoice} is shared over every Club it engages with, counts only once the profile has been shared for{" "}
                {PROTOCOL.verifiedDays} days, and at most {PROTOCOL.baseCapPerReceiver} of anyone&apos;s points can come from it, so outsiders can lift a member but the Club&apos;s
                Holders carry the most. Nobody can back themselves; two people who back each other get half each way; one person gives another at most {DEFAULT_CLUB_RULES.pairCap} points a week; a like taken back, a deleted post, or a post a moderator hid
                counts for nothing. Backing is public once an epoch closes: who backed whom, the voices they gave it with, and what a moderator&apos;s hide removed, so anyone can
                recompute the points (<code>/api/rewards/epochs/&lt;n&gt;/backing</code>), which also means likes are no longer private after that.
              </li>
              <li>
                <b className="text-[#111318]">Each Club&apos;s rules:</b> who is paid is the Owner&apos;s choice, within set limits: only the most active
                Holders (a number, a percentage, or both), the points for a whole share, and a slice of the pool for members without NFTs (up to 30%, split by
                their points). How points are counted is the same in every Club. A change applies from the next epoch, and every epoch publishes the rules it
                used. The Owner can also ban a member from rewards: they aren&apos;t paid, and their likes and replies give nobody points. Both are written to the
                Club&apos;s log.
              </li>
              <li>
                <b className="text-[#111318]">Holdings are averaged:</b> the NFTs you hold are read once a day through the week and once more when the epoch is built, and your
                voice and your share of the pool use the average. NFTs bought on the last day count for a fraction; a day before you joined counts as none.
              </li>
              <li>
                <b className="text-[#111318]">Active days:</b> a day (UTC) when you posted on the Board, replied, or liked another member&apos;s post. At most 7
                an epoch; a deleted post, or one a moderator hid, doesn&apos;t count. Liking the same post again doesn&apos;t add a day.
              </li>
              <li>
                <b className="text-[#111318]">Streaks:</b> {DEFAULT_CLUB_RULES.streakMinDays} or more active days in an epoch keep a streak going. From the second
                epoch in a row it adds {percent(DEFAULT_CLUB_RULES.streakStepBps)} a week, up to {percent(PROTOCOL.maxStreakBps)}, on top of the bonus. The Rewards tab
                shows where you stand while the epoch runs.
              </li>
              <li>
                <b className="text-[#111318]">What counts as about the Club:</b> a link to the Club or its token, a mention of, or a quote or reply to, the
                project&apos;s X account (the Owner links it), or one of the Club&apos;s tags (half).
              </li>
              <li>
                <b className="text-[#111318]">Whose posts:</b> only your own, from the X account linked to your profile, made in the last 48 hours. One a
                day counts per Club, and each X post counts once.
              </li>
              <li>
                <b className="text-[#111318]">Engagement:</b>{" "}
                <span className="mr-1 inline-block rounded-full border-2 border-[#111318] bg-peach px-2 text-[11px] font-black uppercase tracking-wide text-[#111318]">
                  When switched on
                </span>
                until then, every counted post adds the same, however it does on X. Once the operator turns on the X read, likes, reposts, quotes
                and replies on your X post add up to {PROTOCOL.reachCapPerEpoch} more points (capped, so one viral post can&apos;t take everything), and
                a post that was deleted, or edited so it&apos;s no longer about the Club, counts for nothing.
              </li>
            </ul>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted">
            Faking volume to earn rewards loses money: each side of a swap pays the full fee, and only part of it comes back,
            shared with the Club&apos;s other top Holders.
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
