import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { CreateDealButton } from "@/components/CreateDealButton";
import { CheckIcon, ShieldIcon, SwapIcon, WalletIcon } from "@/components/Icons";
import { PRIVY_APP_ID } from "@/lib/config";
import { swapIntents } from "@/lib/contracts";
import { REWARDS, percent } from "@/lib/rewards";
import { termsFor } from "@/lib/settlementTerms";
import { CARD, CardGrid, Checklist, Faq, GuideBody, GuideFooter, GuideHero, MUTED, Section, type GuideSection } from "./parts";

// The Deals guide. The Clubs guide sits beside it at /guide/clubs. The create screen's settlement chips
// link here by anchor (/guide#cant-fail and the rest), so Deals stays at /guide.

const SECTIONS: GuideSection[] = [
  { id: "start", label: "Get started" },
  { id: "make", label: "Make a deal" },
  { id: "take", label: "Take a deal" },
  ...(swapIntents ? [{ id: "settlement", label: "Locked or signed" }] : []),
  { id: "after", label: "After a deal" },
  { id: "fees", label: "Fees" },
  { id: "safety", label: "Stay safe" },
  { id: "faq", label: "FAQ" },
];

const START = [
  {
    icon: <WalletIcon className="size-4" />,
    title: PRIVY_APP_ID ? "Sign in" : "Connect a wallet",
    body: PRIVY_APP_ID ? (
      <>Press <b>Sign in</b> and use Google, X, Discord or a wallet. Then link the wallet that holds your assets.</>
    ) : (
      <>Press <b>Connect wallet</b> and pick the wallet installed in your browser.</>
    ),
  },
  {
    icon: <SwapIcon className="size-4" />,
    title: "Use Monad testnet",
    body: <>If the button says <b>Switch to Monad Testnet</b>, press it. Every deal here runs on testnet.</>,
  },
  {
    icon: <Image src="/brand/mon.svg" alt="" width={20} height={20} className="size-5" />,
    title: "Get test MON",
    body: <>You need a little test MON for gas, plus any MON you want to put in a deal.</>,
  },
];

const MAKE_STEPS = [
  {
    title: "Deal type",
    body: swapIntents ? (
      <>Choose how it settles (lock or sign, explained below), what kind of deal it is, and what you want back.</>
    ) : (
      <>Choose what kind of deal it is, and what you want back.</>
    ),
  },
  {
    title: "Your assets",
    body: (
      <>
        Add what you give with <b>+ MON</b>, <b>+ Token</b> or <b>+ NFT</b>. Choose who can take it (anyone, or one
        wallet) and when it expires: 1 hour, 24 hours, 7 days or never.
      </>
    ),
  },
  {
    title: "Confirm",
    body: (
      <>
        Check the summary, <b>Approve</b> each asset you offer, then <b>Create deal</b>. Your side and your share of
        the fee are now held by the contract.
      </>
    ),
  },
];

const KINDS = [
  { title: "Open offer", body: "Show what you're giving and let people send you offers. You pick the one you like." },
  { title: "Request exact assets", body: "Name exactly what you want back. Whoever holds it can accept in one step." },
  { title: "Request by trait", body: "Ask for NFTs with a trait, like any Chog with a Crown hat. Any match can accept." },
];

const TAKE = [
  {
    kind: "Exact assets",
    body: (
      <>
        Approve what you send if asked, then press <b>Accept &amp; swap</b>. Any MON asked for, plus your share of the
        fee, goes in the same transaction.
      </>
    ),
  },
  {
    kind: "By trait",
    body: <>Choose which of your NFTs to send. Each one is checked against the request before you can accept.</>,
  },
  {
    kind: "Open offer",
    body: (
      <>
        Build an offer from your own assets and press <b>Send offer</b>. It&apos;s held until the maker accepts or
        rejects it. <b>Withdraw my offer</b> works at any time.
      </>
    ),
  },
];

const AFTER: ReadonlyArray<{ title: string; body: ReactNode; signed?: boolean }> = [
  {
    title: "Changed your mind?",
    body: (
      <>
        <b>Cancel deal</b> returns everything you locked, fee included, while the deal is open.
      </>
    ),
  },
  {
    title: "It expired",
    body: (
      <>
        Press <b>Reclaim my assets</b>. Anyone can press <b>Return assets to maker</b>, and it always goes back to you.
      </>
    ),
  },
  {
    title: "Held for you",
    body: (
      <>
        If a payout to you was refused (some contract wallets do this), the deal page shows it as waiting. Press{" "}
        <b>Claim</b> to collect it.
      </>
    ),
  },
  {
    title: "Taking back a signed swap",
    signed: true,
    body: (
      <>
        <b>Remove from pool</b> is free. <b>Cancel on-chain</b> costs gas but makes your signature useless for good.
      </>
    ),
  },
];

const FEES = [
  "A small flat fee per side, so both people pay the same.",
  "Only charged when a deal completes. Cancel, expire, reject or withdraw, and nobody pays.",
  "The exact amount is on screen before you confirm.",
  "It can be cut at any time, but a raise takes a week's notice, and never goes past a cap set at launch.",
  `Most of it goes back to the community: ${percent(REWARDS.holderBps)} to the traded asset's Club Holders and ${percent(REWARDS.fundBps)} to its Club fund, each week.`,
];

const FEE_MODES: ReadonlyArray<[string, string]> = [
  ["Locked deals", "Paid in MON with your side, held with it, and refunded if the deal doesn't complete. The fee a deal was listed with is the fee both sides pay."],
  ["Signed swaps", "Paid in WMON (wrapped MON) when the swap settles. You sign the most you'll pay; if the fee drops first, you pay less."],
];

const SAFETY = [
  "Check you're on Monad testnet, with the wallet you expect.",
  "Read every asset, token id and amount on both sides.",
  "Check who can accept and when the deal expires.",
  "Compare a handle and its wallet with your conversation. Lookalikes exist.",
  "Never approve a contract address someone sent you in a message.",
  "An open offer's note is written by its maker, not checked by DeClub.",
];

/** Locked deals against signed swaps, row by row. The one-line reasons live in lib/settlementTerms.ts. */
const COMPARE: ReadonlyArray<[string, string, string]> = [
  ["Can it fail?", "No. Once someone accepts, both sides move together.", "Yes, if you move the asset or revoke the approval before a match."],
  ["What it costs", "Gas to create, and again to cancel. Approvals cost gas too.", "Nothing to post or remove. You only pay for approvals."],
  ["Your assets", "Held by the contract until it's accepted, cancelled or expires.", "Stay in your wallet the whole time."],
  ["What you can use", "MON, NFTs, tokens, trait requests and open offers.", "NFTs and tokens. MON must be wrapped as WMON. No trait requests."],
  ["Who can take it", "Anyone, one named wallet, or you pick from the offers you receive.", "Anyone that meets your terms. A matcher finds pairs and rings of up to 4 wallets."],
  ["How it ends", "Accepted, cancelled by you, or expired and reclaimed. Expiry is optional.", "Settled by a match, removed from the pool, or its deadline passes (10 minutes to 7 days)."],
];

const MODES = [
  { mode: "escrow", title: "Lock assets now", bestFor: "A specific buyer, a big trade, or anything with MON or a trait." },
  { mode: "signed", title: "Sign only", bestFor: "Quick NFT and token swaps, without locking anything or paying to post." },
] as const;

/** Only shown where signed swaps exist. */
const SIGNED_FAQ: ReadonlyArray<[string, string]> = [
  ["Should I lock my assets or just sign?", "Lock them when the other side must be certain it will go through: a specific buyer, a big trade, or anything with MON or a trait. Sign when you want a quick swap of NFTs and tokens without locking anything or paying gas to post."],
  ["Why can a signed swap fail?", "Nothing is held, so the swap only works if your asset and approval are still in place when a match is found. If they aren't, the settlement is rejected as a whole and nobody loses anything, but your swap doesn't happen. It shows as Paused and comes back once you fix it."],
  ["Can I sign several swaps with the same NFT?", "No. Each NFT can be in only one of your open signed swaps at a time, and your open swaps together can't give more of a token than your wallet holds. The pool also takes up to 20 open swaps per wallet. Remove a swap from the pool to free what it gives."],
  ["Can I take back a signed swap?", "Removing it from the pool is free, but a copy of your signature that already left the pool could still be used until it expires. For certainty, cancel it on-chain, which costs gas. A short deadline is the best protection."],
];

/** Only shown with Privy sign-in, which the handle lookup needs. */
const HANDLE_FAQ: [string, string] = [
  "Can I make a deal for one person by their handle?",
  "Yes. In Only this wallet can accept, type their X or Discord handle, like @bob, and press Find. It finds people who chose to show their profile, and you pick the wallet they'll accept from. A handle shows the account and the wallet belong together, not that the person is honest.",
];

const FAQ: ReadonlyArray<[string, string]> = [
  ["What is DeClub?", "A peer-to-peer way to swap NFTs, tokens and MON on Monad. You agree the terms with someone, and a smart contract swaps both sides at once. There's no middleman holding your assets."],
  ["Do I have to trust the other person?", "No. The swap is atomic: every transfer in it succeeds, or the whole transaction is undone. The other side can never take your assets without sending theirs."],
  ["Where are my assets while a deal is open?", "In a locked deal, inside the DeClub contract, until the deal is accepted, you cancel it, or it expires and you reclaim it. In a signed swap, they never leave your wallet."],
  ["Why do I need to approve DeClub?", "A contract can only move your NFTs or tokens with your permission. For an NFT collection, one approval covers all its NFTs, so you usually do it once. For a token, you approve the exact amount in the deal. Each approval costs a little gas."],
  ["What is an open offer?", "A deal where you only say what you're giving. Others send offers from their own assets, and their side is held in the contract too. You accept the one you like, and the rest can be withdrawn by their senders."],
  ["Is this mainnet?", "No. This is a demo on Monad testnet with test assets. Treat them as disposable, and never send valuable assets to an unfamiliar contract."],
];

const FAQ_ITEMS = [
  ...FAQ.slice(0, 3),
  ...(swapIntents ? SIGNED_FAQ : []),
  ...FAQ.slice(3, 5),
  ...(PRIVY_APP_ID ? [HANDLE_FAQ] : []),
  ...FAQ.slice(5),
];

export default function GuidePage() {
  return (
    <div className="space-y-10 pb-10">
      <GuideHero
        base="deals"
        title="How deals work,"
        accent="in five minutes."
        lead="Make a deal, take one, and get your assets back if it doesn't happen. Every step, in plain words."
        actions={
          <>
            <CreateDealButton />
            <Link href="/deals" className="btn-secondary">
              Browse deals <span aria-hidden>↗</span>
            </Link>
          </>
        }
        summary={["Both sides move together, or nothing moves.", "You only pay the fee when a deal completes.", "Testnet only: use test assets."]}
        sections={SECTIONS}
      />

      <GuideBody sections={SECTIONS}>
        <Section sections={SECTIONS} id="start" title="Before your first deal">
          <CardGrid items={START} />
        </Section>

        <Section sections={SECTIONS} id="make" title="Make a deal in three steps" intro={<>Press <b>Create deal</b> and follow the steps.</>}>
          <ol className={`${CARD} divide-y divide-[#111318]/10`}>
            {MAKE_STEPS.map((step, i) => (
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

          <h3 className="mt-10 mb-4 text-lg font-black">Three kinds of deal</h3>
          <CardGrid items={KINDS} />
          <p className="mt-4 text-sm leading-6 text-muted">
            Each side holds up to 10 assets: any mix of NFTs, tokens and MON. To make a deal for one person, put their
            wallet{PRIVY_APP_ID ? " or their X or Discord handle" : ""} in <b>Only this wallet can accept</b>.
          </p>
        </Section>

        <Section
          sections={SECTIONS}
          id="take"
          title="Take a deal"
          intro={<>Open a deal from <b>Deals</b>. The page shows what you get, what you give, and your next move.</>}
        >
          <dl className={`${CARD} divide-y divide-[#111318]/10`}>
            {TAKE.map((row) => (
              <div key={row.kind} className="grid gap-2 p-5 sm:grid-cols-[9rem_1fr] sm:gap-6 sm:p-6">
                <dt className="font-black">{row.kind}</dt>
                <dd className={`text-sm leading-6 ${MUTED}`}>{row.body}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 flex items-start gap-2.5 rounded-xl border-2 border-dashed border-[#111318]/30 p-4 text-sm leading-6">
            <ShieldIcon className="mt-0.5 size-5 shrink-0 text-[#1f7a55]" />
            <span>
              <b>Nothing can half-happen.</b> Both sides move in one transaction. If any part fails, the whole thing is
              undone and everyone keeps what they had.
            </span>
          </p>
        </Section>

        {swapIntents && (
          <Section
            sections={SECTIONS}
            id="settlement"
            title="Lock your assets, or just sign"
            intro={
              <>
                Every deal settles one of two ways, and you choose when you create it. Both show up in the same list,
                tagged Locked or Signed.
              </>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
              {MODES.map(({ mode, title, bestFor }) => (
                <div key={mode} className={`${CARD} p-5 sm:p-6`}>
                  <h3 className="text-lg font-black">{title}</h3>
                  <p className={`mt-1 text-sm leading-6 ${MUTED}`}>
                    <b className="text-[#111318]">Best for:</b> {bestFor}
                  </p>
                  <dl className="mt-5 space-y-4 border-t border-[#111318]/10 pt-5">
                    {termsFor(mode).map((term) => (
                      <div
                        key={term.id}
                        id={term.id}
                        className="scroll-mt-24 rounded-lg target:-m-2 target:bg-white target:p-2 target:outline-2 target:outline-accent"
                      >
                        <dt className="flex items-center gap-2 text-sm font-black">
                          <span
                            aria-hidden
                            className={`grid size-5 place-items-center rounded-full border-2 border-[#111318] text-xs leading-none ${
                              term.good ? "bg-mint" : "bg-peach"
                            }`}
                          >
                            {term.good ? "+" : "−"}
                          </span>
                          {term.label}
                        </dt>
                        <dd className={`mt-1 text-sm leading-6 ${MUTED}`}>{term.detail}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>

            <details className={`${CARD} group mt-4`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 font-black">
                Compare them side by side
                <span className="text-xl font-normal text-accent transition-transform group-open:rotate-45" aria-hidden>+</span>
              </summary>
              <div className="overflow-x-auto border-t border-[#111318]/10">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead>
                    <tr className="text-xs tracking-wider text-[#4e5968] uppercase">
                      <th className="px-5 py-3" />
                      <th className="px-5 py-3 font-black">Lock assets now</th>
                      <th className="px-5 py-3 font-black">Sign only</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#111318]/10">
                    {COMPARE.map(([row, locked, signed]) => (
                      <tr key={row} className="align-top">
                        <th scope="row" className="px-5 py-3.5 font-black whitespace-nowrap">{row}</th>
                        <td className={`px-5 py-3.5 leading-6 ${MUTED}`}>{locked}</td>
                        <td className={`px-5 py-3.5 leading-6 ${MUTED}`}>{signed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Section>
        )}

        <Section sections={SECTIONS} id="after" title="When a deal doesn't happen">
          <CardGrid cols={2} items={AFTER.filter((item) => !item.signed || swapIntents)} />
        </Section>

        <Section sections={SECTIONS} id="fees" title="What it costs">
          <div className={`${CARD} p-5 sm:p-6`}>
            <ul className="space-y-2.5 text-sm leading-6">
              {FEES.map((line) => (
                <li key={line} className="flex gap-2.5">
                  <CheckIcon className="mt-1 size-4 shrink-0 text-[#1f7a55]" />
                  {line}
                </li>
              ))}
            </ul>
            <dl className="mt-5 grid gap-4 border-t border-[#111318]/10 pt-5 sm:grid-cols-2">
              {FEE_MODES.filter(([mode]) => mode !== "Signed swaps" || swapIntents).map(([mode, text]) => (
                <div key={mode}>
                  <dt className="text-sm font-black">{mode}</dt>
                  <dd className={`mt-1 text-sm leading-6 ${MUTED}`}>{text}</dd>
                </div>
              ))}
            </dl>
            <p className={`mt-5 border-t border-[#111318]/10 pt-4 text-sm ${MUTED}`}>
              You also pay Monad&apos;s network gas for each transaction.
            </p>
          </div>
        </Section>

        <Section sections={SECTIONS} id="safety" title="Before you confirm">
          <Checklist items={SAFETY} />
        </Section>

        <Section sections={SECTIONS} id="faq" title="Questions, answered">
          <Faq items={FAQ_ITEMS} />
        </Section>

        <GuideFooter
          other={{ href: "/guide/clubs", title: "Clubs guide", body: "Join a community, earn a Holder badge, and post what you're after." }}
        />
      </GuideBody>
    </div>
  );
}
