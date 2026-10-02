import Link from "next/link";
import Image from "next/image";
import { OnDealArt } from "@/components/ChogArt";
import { ClubsIntro } from "@/components/ClubsIntro";
import { CreateDealButton } from "@/components/CreateDealButton";

const STEPS = [
  {
    number: "01",
    title: "Lock your offer",
    body: "Pick the assets (and any MON) you want to give. Creating the deal escrows your side in the contract.",
  },
  {
    number: "02",
    title: "Name what you want",
    body: "Ask for specific assets, a trait, or MON. Keep it public, or address it to a single wallet.",
  },
  {
    number: "03",
    title: "Swap atomically",
    body: "When someone accepts, both sides move in one transaction. Either everything transfers or nothing does.",
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
              Peer-to-peer deals · Monad testnet
            </div>
            <h1 className="mt-5 text-4xl font-black leading-[0.95] tracking-tight sm:text-6xl">
              Swap what you have
              <span className="block text-accent">for what you want.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
              Swap assets peer-to-peer. Lock your offer, find the one you want, and let the
              contract settle both sides together. No middlemen. Just a little chaos.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/deals" className="btn-primary">
                Browse deals <span aria-hidden>↗</span>
              </Link>
              <CreateDealButton />
            </div>
          </div>
          <OnDealArt />
        </div>
        <div className="grid border-t border-white/10 bg-black/10 sm:grid-cols-3">
          <div className="hero-stat"><strong>Non-custodial</strong><span>Your assets stay yours until a swap</span></div>
          <div className="hero-stat"><strong>Permissionless</strong><span>Public or direct offers, your choice</span></div>
          <div className="hero-stat"><strong>Pay only on success</strong><span>A small flat fee, only when a deal completes</span></div>
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
          <p className="font-semibold">New to On Deal?</p>
          <p className="mt-1 text-sm text-muted">
            Learn how escrow, approvals, expiry, and atomic settlement work.
          </p>
        </div>
        <Link href="/guide" className="btn-secondary shrink-0">Read the field guide</Link>
      </section>
    </>
  );
}
