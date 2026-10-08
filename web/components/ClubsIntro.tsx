import Link from "next/link";
import { ChatIcon, CoinIcon, TagIcon, TrophyIcon, UsersIcon } from "@/components/Icons";
import { HeatBars } from "@/components/MomentumBadge";
import { HEAT } from "@/lib/clubs";
import { PROTOCOL, percent } from "@/lib/rewards";
import { ClubsTeaser } from "./ClubsTeaser";

const WHAT = [
  { icon: <ChatIcon className="size-5" />, title: "Board", body: "Post, reply and like, and share your X posts. Signed by your wallet." },
  { icon: <CoinIcon className="size-5" />, title: "Rewards", body: `${percent(PROTOCOL.holderBps)} of the Club's swap fees goes to its active Holders each week, and ${percent(PROTOCOL.fundBps)} to the Club fund.` },
  { icon: <TagIcon className="size-5" />, title: "Market", body: "Every open deal and request for the asset, in one place." },
  { icon: <UsersIcon className="size-5" />, title: "Members", body: "A leaderboard ranked by Momentum, with Holder badges. Follow who you trust." },
];

/** Under the four tabs, one row across: how an Owner rewards the members who show up. */
const CHALLENGES = { icon: <TrophyIcon className="size-5" />, title: "Challenges", body: "The Owner sets a task, members answer with a post, and the winners get points, a trophy or a prize." };

const HOW = [
  { title: "Completed swaps count most", body: "Each side pays the fee for every NFT it gives, so faking a busy market costs real money." },
  { title: "New deals count a little", body: "Up to a daily limit per wallet, so spam doesn't pay." },
  { title: "Holders' posts count a little", body: "A Holder's first Board post of the day, and their own X posts about the Club." },
  { title: "Everything fades", body: "Old activity counts less each day, so a Club stays hot only by staying busy." },
];

/** The home page's introduction to Clubs. The Clubs themselves live at /clubs. */
export function ClubsIntro() {
  return (
    <section id="clubs" aria-labelledby="clubs-title" className="mb-12 scroll-mt-24">
      <div className="grid items-start gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="kicker text-[#a9282f]!">Clubs</p>
          <h2 id="clubs-title" className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">
            Every collection gets a Club, and the Club shares in its market.
          </h2>
          <p className="mt-3 max-w-xl leading-7 text-muted">
            Each verified NFT collection has a Club: one place to talk, find what’s up for trade, and see who really
            takes part. A memecoin made for a collection joins that collection’s Club.
          </p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {WHAT.map((item) => (
              <li key={item.title}>
                <span className="grid size-10 place-items-center rounded-xl border-2 border-[#111318] bg-[#f0b735]">
                  {item.icon}
                </span>
                <p className="mt-2.5 font-extrabold">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted">{item.body}</p>
              </li>
            ))}
            <li className="flex items-start gap-3 rounded-xl border-2 border-dashed border-[#111318]/30 p-4 sm:col-span-2">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border-2 border-[#111318] bg-[#f0b735]">
                {CHALLENGES.icon}
              </span>
              <span>
                <span className="block font-extrabold">{CHALLENGES.title}</span>
                <span className="mt-1 block text-sm leading-6 text-muted">{CHALLENGES.body}</span>
              </span>
            </li>
          </ul>
          <Link href="/clubs" className="btn-primary mt-7">
            Explore Clubs <span aria-hidden>→</span>
          </Link>
        </div>
        <ClubsTeaser />
      </div>

      <h3 className="mt-12 text-xl font-black tracking-tight">How Momentum works</h3>
      <p className="mt-1 text-sm text-muted">Clubs are ranked by Momentum. It measures trading, not hype, and doesn’t say an asset is safe or valuable.</p>
      <ol className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {HOW.map((step, i) => (
          <li key={step.title} className="page-section p-6">
            <span className="font-mono text-sm font-semibold text-accent">0{i + 1}</span>
            <h4 className="mt-3 text-lg font-semibold">{step.title}</h4>
            <p className="mt-2 text-sm leading-6 text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
      <ul className="mt-5 flex flex-wrap items-center gap-2" aria-label="Heat scale">
        {HEAT.map((step, level) => (
          <li key={step.label} className="chip gap-2 bg-white py-1">
            <HeatBars level={level} />
            {step.label}
            <span className="font-semibold text-muted tabular-nums">{level === 0 ? "0" : `${step.min}+`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
