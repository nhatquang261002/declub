import Link from "next/link";
import { ChatIcon, CrownIcon, FlagIcon, FlameIcon, ShieldIcon, TagIcon, UsersIcon } from "@/components/Icons";
import { MAX_MODERATORS } from "@/lib/clubRoles";
import { MAX_LINKS, MAX_PINNED, POST_COOLDOWN_SEC, POST_MAX, POSTS_PER_HOUR, REPORTS_TO_HIDE } from "@/lib/clubPosts";
import { PRIVY_APP_ID } from "@/lib/config";
import { MOMENTUM } from "@/lib/momentum";
import { CARD, CardGrid, Checklist, Faq, GuideBody, GuideFooter, GuideHero, MUTED, Section, type GuideSection } from "../parts";

// The Clubs guide, beside the Deals guide at /guide. The numbers come from the same constants the server enforces, so the
// page can't drift from the rules. The longer version is the Clubs section of docs/07-user-guide.md.

const SECTIONS: GuideSection[] = [
  { id: "what", label: "What a Club is" },
  { id: "join", label: "Join a Club" },
  { id: "badges", label: "Badges" },
  { id: "post", label: "Post and report" },
  { id: "roles", label: "Who runs a Club" },
  { id: "safety", label: "Stay safe" },
  { id: "faq", label: "FAQ" },
];

const TABS = [
  { icon: <TagIcon className="size-4" />, title: "Market", body: <>Open deals and signed swaps for the asset, split into <b>For trade</b> and <b>Wanted</b>, plus <b>Recent swaps</b>.</> },
  { icon: <ChatIcon className="size-4" />, title: "Board", body: <>Short posts from members. A <i>Looking for</i> post can link one of the Club&apos;s own deals.</> },
  { icon: <UsersIcon className="size-4" />, title: "Members", body: <>A leaderboard of the people in the Club, ranked by how much they trade it.</> },
  { icon: <ShieldIcon className="size-4" />, title: "Manage", body: <>Only for the Club&apos;s staff: the description, links, pinned posts, moderators and bans.</> },
];

const JOIN_STEPS = [
  { title: "Sign in and link a wallet", body: <>Press <b>Sign in</b>, then link the wallet you trade with on the <b>Account</b> page.</> },
  { title: "Press Join", body: <>Open the Club from <b>Clubs</b> and press <b>Join</b>. Anyone signed in can join.</> },
  { title: "Leave any time", body: <><b>Leave</b> takes you off the Members list again.</> },
];

const MOMENTUM_RULES = [
  { title: "Completed swaps count most", body: `${MOMENTUM.swapWeight} points for each side of a finished trade.` },
  { title: "New deals count a little", body: `${MOMENTUM.createdWeight} points each, at most ${MOMENTUM.createdPerDay} a day per wallet. Posts count for nothing.` },
  { title: "Everything fades", body: `Points halve every ${MOMENTUM.halfLifeDays} days and are gone after ${MOMENTUM.windowDays}.` },
];

const POST_RULES = [
  "Be a member, and share a verified X or Discord profile on the Account page.",
  `Plain text, up to ${POST_MAX} characters. No formatting, and links aren't clickable.`,
  `One post every ${POST_COOLDOWN_SEC} seconds, and ${POSTS_PER_HOUR} an hour in each Club.`,
  "Delete your own posts whenever you like.",
];

const ROLES: ReadonlyArray<{ icon: React.ReactNode; role: string; who: string; can: string }> = [
  {
    icon: <CrownIcon className="size-4" />,
    role: "Owner",
    who: "The wallet the token contract names as its owner, once it presses Claim. Or someone the app's admins picked.",
    can: `Edits the description and up to ${MAX_LINKS} links, pins up to ${MAX_PINNED} posts, appoints up to ${MAX_MODERATORS} moderators, can limit posting to Holders, and can hand the Club to another member.`,
  },
  {
    icon: <ShieldIcon className="size-4" />,
    role: "Moderator",
    who: "Appointed by the Owner.",
    can: "Hides, restores and deletes posts, and bans or unbans members of this Club. Can't act on the Owner or other moderators.",
  },
  {
    icon: <UsersIcon className="size-4" />,
    role: "Member",
    who: "Anyone who joined.",
    can: "Posts, reports, and appears on the leaderboard.",
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
  "A post or a profile link is written by a member, not checked by On Deal.",
  "A Holder badge or a high Momentum is not an endorsement of the person or the asset.",
  "A deal linked from a post is still just a deal: check every asset before you sign.",
];

const FAQ: ReadonlyArray<[string, string]> = [
  ["Does a Club change how my deals work?", "No. Clubs are community pages run by the app's server. Nothing in a deal, a fee or a settlement depends on one, and leaving a Club doesn't touch your deals."],
  ["Which assets get a Club?", "Only NFT collections and memecoins on On Deal's verified list, so a copycat can't get one. A memecoin made for a collection shares that collection's Club."],
  ["Why can't I post?", "You need to be a member and to have shared a verified X or Discord profile. Some Owners also limit posting to Holders. If you posted a moment ago, wait for the cooldown."],
  ["How does someone become the Owner?", "The wallet that the token contract names as its owner presses Claim on the Club page. The app's admins can also pick an Owner."],
  ["What happens if I'm banned?", "You leave the Club, lose any role, and can't rejoin or post there. The app's admins can ban someone from every Club. Staff actions are written to a log that only staff can read."],
];

export default function ClubsGuidePage() {
  return (
    <div className="space-y-10 pb-10">
      <GuideHero
        base="clubs"
        title="How Clubs work,"
        accent="in three minutes."
        lead="Every verified collection and memecoin has a Club: its market, a board for posts, and the people who trade it."
        actions={
          <Link href="/clubs" className="btn-primary">
            Explore Clubs <span aria-hidden>→</span>
          </Link>
        }
        summary={["Anyone signed in can join.", "Badges and Momentum show activity, not trust.", "Clubs never touch your deals."]}
        sections={SECTIONS}
      />

      <GuideBody sections={SECTIONS}>
        <Section
          sections={SECTIONS}
          id="what"
          title="A home for each asset"
          intro={<>Open <b>Clubs</b> in the header to see them all, busiest first. Each Club has four tabs.</>}
        >
          <CardGrid cols={2} items={TABS} />
        </Section>

        <Section sections={SECTIONS} id="join" title="Join in three steps">
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
              to show.{!PRIVY_APP_ID && " Sign-in is off on this deployment, so joining and posting aren't available here."}
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
                the collection, or the minimum amount of a token. In a shared Club, either one counts.
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
                Report a post that&apos;s spam or abuse, once per post and never your own. When {REPORTS_TO_HIDE} different
                Holders (or staff) have reported it, the post is hidden from everyone except its author and the staff.
                Every report reaches the staff, and posts by the Owner or a Moderator are never hidden by reports.
              </p>
              <p className={`mt-3 text-sm leading-6 ${MUTED}`}>A moderator then restores it or deletes it.</p>
            </div>
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
