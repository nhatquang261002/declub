import Link from "next/link";
import Image from "next/image";
import { DeClubArt } from "@/components/ChogArt";
import { ClubsIntro } from "@/components/ClubsIntro";
import { CreateDealButton } from "@/components/CreateDealButton";
import { LogoMark, Wordmark } from "@/components/Logo";
import { explorerAddress, DECLUB_ESCROW_ADDRESS } from "@/lib/config";
import { NETWORK } from "@/lib/network";
import { REWARDS, percent } from "@/lib/rewards";

const STEPS = [
  {
    number: "01",
    title: "Join your Club",
    body: "Every verified Monad NFT collection has one, with its memecoin if it has one. Join with your wallet; holding the NFT makes you a Holder, and the Owner can let the coin count too.",
  },
  {
    number: "02",
    title: "Trade and talk inside it",
    body: "Swap with other members, lock a deal or sign one, and post what you’re after. Your wallet signs your posts, so they’re yours.",
  },
  {
    number: "03",
    title: "Own a share of the market",
    body: `Each completed swap pays a small fee. Every week ${percent(REWARDS.holderBps)} of it goes back to the Club’s biggest Holders and ${percent(REWARDS.fundBps)} to its Owner’s Club fund, paid in MON.`,
  },
];

export default function HomePage() {
  return (
    <>
      <section className="hero-panel mb-12 overflow-hidden">
        <div className="relative grid items-center gap-8 px-6 py-8 sm:px-10 sm:py-12 lg:grid-cols-[1.15fr_0.85fr] lg:px-14">
          <div className="relative z-10 max-w-2xl">
            <div className="eyebrow">
              <Image
                src="/brand/Badge_(Face_Chog)/FACE_CHOG.svg"
                alt=""
                width={18}
                height={18}
                className="size-[18px] rounded-full"
              />
              De(al) Club · {NETWORK.name}
            </div>
            <h1 className="mt-5 text-4xl font-black leading-[0.95] tracking-tight sm:text-6xl">
              Your community’s market,
              <span className="block text-accent">owned by its members.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
              Every Monad NFT collection gets a Club, and its memecoin comes with it. Members trade inside it, talk in posts they sign and own,
              and Holders earn a share of the fees their Club’s swaps pay.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/clubs" className="btn-primary">
                Explore Clubs <span aria-hidden>→</span>
              </Link>
              <Link href="/deals" className="btn-secondary">
                Browse deals
              </Link>
              <CreateDealButton />
            </div>
          </div>
          <DeClubArt />
        </div>
        <div className="grid border-t border-white/10 bg-black/10 sm:grid-cols-3">
          <div className="hero-stat"><strong>{percent(REWARDS.holderBps)} to top Holders</strong><span>Of the fees your Club’s swaps pay, every week</span></div>
          <div className="hero-stat"><strong>Posts you own</strong><span>Signed by your wallet, exportable anywhere</span></div>
          <div className="hero-stat"><strong>Non-custodial</strong><span>Assets move only in swaps you approve</span></div>
        </div>
      </section>

      <section aria-labelledby="how-it-works" className="mb-12">
        <h2 id="how-it-works" className="text-2xl font-bold tracking-tight sm:text-3xl">
          How it works
        </h2>
        <ol className="mt-6 grid gap-3 md:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.number} className="page-section p-6">
              <span className="font-mono text-sm font-semibold text-accent">{step.number}</span>
              <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <ClubsIntro />

      <section className="page-section flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
        <div>
          <p className="font-semibold">New to DeClub?</p>
          <p className="mt-1 text-sm text-muted">
            Learn how Clubs, rewards and signed posts work, and how a swap settles safely.
          </p>
        </div>
        <Link href="/guide/clubs" className="btn-secondary shrink-0">Read the field guide</Link>
      </section>

      <footer className="relative mt-12 overflow-hidden rounded-2xl border-2 border-[#111318] bg-[#171a22] p-6 text-sm text-white shadow-[0.45rem_0.45rem_0_#d83b45] sm:p-9">
        <div className="absolute -right-12 -top-16 size-44 rounded-full border-[18px] border-[#315ea8]/40" aria-hidden />
        <div className="absolute -bottom-20 left-1/3 size-40 rounded-full bg-[#d83b45]/10" aria-hidden />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-6 border-b border-white/15 pb-8">
            <div className="max-w-md">
              <div className="flex items-center gap-3">
                <LogoMark className="size-11" />
                <Wordmark className="text-2xl" />
              </div>
              <p className="mt-5 text-xl font-semibold leading-tight text-[#fff4cf] sm:text-2xl">
                Communities that own their market.
              </p>
              <p className="mt-2 leading-6 text-white/60">
                Clubs, swaps and rewards for Monad’s NFT collections and their coins, on {NETWORK.name}.
              </p>
            </div>
            <a
              href="mailto:support@declub.app"
              className="rounded-xl border border-[#f0b735] px-4 py-3 font-semibold text-[#f0b735] transition-colors hover:bg-[#f0b735] hover:text-[#111318]"
            >
              Need a hand? Contact support <span aria-hidden>↗</span>
            </a>
          </div>

          <div className="grid gap-8 pt-8 sm:grid-cols-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#f0b735]">Explore</p>
              <nav className="mt-3 grid gap-2 text-white/70">
                <Link href="/clubs" className="hover:text-white">Clubs <span aria-hidden>↗</span></Link>
                <Link href="/deals" className="hover:text-white">Browse deals</Link>
                <Link href="/history" className="hover:text-white">History</Link>
                <Link href="/guide" className="hover:text-white">Guide</Link>
              </nav>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#f0b735]">On-chain</p>
              <nav className="mt-3 grid gap-2 text-white/70">
                {DECLUB_ESCROW_ADDRESS && (
                  <a href={explorerAddress(DECLUB_ESCROW_ADDRESS)} target="_blank" rel="noreferrer" className="hover:text-white">
                    View DeClub contract <span aria-hidden>↗</span>
                  </a>
                )}
                <span>{NETWORK.name}</span>
                <span className="font-mono text-xs text-white/50">Chain ID {NETWORK.chainId}</span>
              </nav>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#f0b735]">Stay safe</p>
              <p className="mt-3 leading-6 text-white/70">
                {NETWORK.mainnet ? "Real assets move here." : "Testnet only."} Never send valuable assets to an unfamiliar contract.
              </p>
            </div>
          </div>
          <p className="mt-8 border-t border-white/15 pt-4 text-xs text-white/40">
            Assets move only in transactions you approve.
          </p>
        </div>
      </footer>
    </>
  );
}
