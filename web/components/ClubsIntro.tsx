import Link from "next/link";
import { ChatIcon, CoinIcon, TagIcon, UsersIcon } from "@/components/Icons";
import { HeatBars } from "@/components/MomentumBadge";
import { HEAT } from "@/lib/clubs";
import { MOMENTUM } from "@/lib/momentum";
import { REWARDS, percent } from "@/lib/rewards";
import { ClubsTeaser } from "./ClubsTeaser";

const WHAT = [
  { icon: <TagIcon className="size-5" />, title: "Market", body: "Every open offer and request for the asset, in one place." },
  { icon: <ChatIcon className="size-5" />, title: "Board", body: "Post what you're after, reply, or share your X posts, signed by your wallet, and pick how the feed is ordered." },
  { icon: <UsersIcon className="size-5" />, title: "Members", body: "A leaderboard ranked by Momentum, with Holder badges. Follow who you trust." },
  { icon: <CoinIcon className="size-5" />, title: "Rewards", body: `${percent(REWARDS.holderBps)} of the Club's swap fees goes to its ${REWARDS.maxHolders} biggest Holders each week, more to the ones who post, and ${percent(REWARDS.fundBps)} to the Club fund.` },
];

const HOW = [
  { title: "Completed swaps count most", body: `${MOMENTUM.swapWeight} points for each side of a finished trade. Each side pays the fee for every NFT it gives, so faking it costs real money.` },
  { title: "New deals count a little", body: `${MOMENTUM.createdWeight} points for each new deal or signed swap, at most ${MOMENTUM.createdPerDay} a day per wallet, so spam doesn't pay.` },
  { title: "Attention counts a little", body: `${MOMENTUM.xShareWeight} points when a Holder shares their own X post about the Club, one a day.` },
  { title: "Everything fades", body: `An event's weight halves every ${MOMENTUM.halfLifeDays} days and is gone after ${MOMENTUM.windowDays}. A Club stays hot only by staying busy.` },
];

/** The home page's introduction to Clubs and Momentum. The Clubs themselves live at /clubs. */
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
            Each verified NFT collection has a Club: one place to find what’s up for trade, post what you’re after,
            and see who really trades it. A memecoin made for a collection joins that collection’s Club; a memecoin has none of its own.
          </p>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {WHAT.map((item) => (
              <li key={item.title}>
                <span className="grid size-10 place-items-center rounded-xl border-2 border-[#111318] bg-[#f0b735] shadow-[0.15rem_0.15rem_0_#111318]">
                  {item.icon}
                </span>
                <p className="mt-2.5 font-extrabold">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-muted">{item.body}</p>
              </li>
            ))}
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
