import { CreateDealButton } from "@/components/CreateDealButton";
import { swapIntents } from "@/lib/contracts";
import { termsFor } from "@/lib/settlementTerms";

const STEPS = [
  {
    number: "01",
    title: "Connect your wallet",
    body: "Use an injected wallet such as MetaMask or Rabby, and switch to Monad testnet. You will need test MON for gas and any MON you include in a deal.",
  },
  {
    number: "02",
    title: "Create an offer",
    body: "Choose the assets you want to give, then enter the asset IDs or MON you want in return. You can make the offer public or address it to one wallet.",
  },
  {
    number: "03",
    title: "Approve and lock",
    body: "Approve On Deal once so it can escrow your offered assets. Creating the deal then locks your side in the contract immediately.",
  },
  {
    number: "04",
    title: "Accept a deal",
    body: "Open a deal where you own every requested asset. Approve the collection if needed, then Accept & Swap. The contract settles both sides atomically.",
  },
];

/** Locked deals against signed swaps, row by row. The one-line reasons live in lib/settlementTerms.ts. */
const COMPARE: ReadonlyArray<[string, string, string]> = [
  ["Can it fail?", "No. Once someone accepts, both sides move together.", "Yes, if you move the asset or revoke the approval before a match."],
  ["What it costs", "Gas to create, and again to cancel. Approvals cost gas too.", "Nothing to post or remove. You only pay for approvals."],
  ["Your assets", "Held by the contract until it's accepted, cancelled or expires.", "Stay in your wallet the whole time."],
  ["What you can use", "MON, NFTs, tokens and trait requests.", "NFTs and tokens. MON must be wrapped as WMON. No trait requests."],
  ["Who can take it", "Anyone, one named wallet, or you pick from the offers you receive.", "Anyone that meets your terms. A matcher finds pairs and rings of up to 4 wallets."],
  ["How it ends", "Accepted, cancelled by you, or expired and reclaimed. Expiry is optional.", "Settled by a match, removed from the pool, or its deadline passes (10 minutes to 7 days, required)."],
];

/** Only shown where signed swaps exist. */
const SIGNED_FAQ: ReadonlyArray<[string, string]> = [
  ["Should I lock my assets or just sign?", "Lock them when the other side must be certain it will go through: a specific buyer, a big trade, or anything with MON or a trait. Sign when you want a quick swap of NFTs and tokens without locking anything or paying gas to post. See Locked deals vs signed swaps above."],
  ["Why can a signed swap fail?", "Nothing is held, so the swap only works if your asset and approval are still in place when a match is found. If they aren't, the settlement is rejected as a whole and nobody loses anything, but your swap doesn't happen. It shows as Paused and comes back once you fix it."],
  ["Can I take back a signed swap?", "Removing it from the pool is free, but a copy of your signature that already left the pool could still be used until it expires. For certainty, cancel it on-chain, which costs gas. A short deadline is the best protection."],
];

const FAQ: ReadonlyArray<[string, string]> = [
  ["What is On Deal?", "On Deal is a peer-to-peer, non-custodial way to swap digital assets. The smart contract holds the maker's side and settles the exchange only when the taker provides the requested side."],
  ["Do I have to trust the other party?", "No. The swap is atomic: either every NFT and MON transfer succeeds, or the transaction reverts. The other party never receives your escrowed assets without sending their side."],
  ["What does escrow mean here?", "When you create an open deal, the assets you offer move into the On Deal contract. They remain there until the deal is filled, cancelled by you, or reclaimed after expiry."],
  ["Can I cancel my deal?", "Yes. The maker can cancel any open deal before it is filled. Your escrowed assets and offered MON are returned to your wallet."],
  ["What happens when a deal expires?", "An expired deal cannot be filled. The maker, or another wallet on the maker's behalf, can call Reclaim to return the escrowed assets."],
  ["Who can accept a deal?", "Public deals can be accepted by any wallet that owns all requested assets. A direct deal can only be accepted by the wallet named by the maker."],
  ["Are there platform fees?", "Multi-asset and signed deals charge a small flat protocol fee per side, so both people pay the same. It is only charged when the deal completes: if you cancel, it expires, or an offer is rejected or withdrawn, nobody pays it. The screens show the exact amount before you confirm. In a locked deal it is sent in MON with your side and held with it, and refunded if the deal doesn't complete. In a signed swap it is taken in WMON (wrapped MON) from your wallet when the swap settles, and the first step wraps the MON you need. You also pay the Monad transaction cost. Deals on the original single-collection contract have no fee."],
  ["Why do I need to approve On Deal?", "ERC-721 collections require your permission before a contract can transfer your NFTs. Approval is a one-time collection-wide permission for this swap contract."],
  ["Is this mainnet?", "The current demo runs on Monad testnet with test assets. Treat them as disposable and never send valuable assets to an unfamiliar contract."],
];

export default function GuidePage() {
  return (
    <div className="pb-10">
      <section className="border-b border-black/10 pb-10 pt-4 sm:pb-12">
        <p className="text-sm font-semibold text-accent">Documentation / Guide</p>
        <div className="mt-4 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">How to use On Deal</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg">
              Everything you need to make a safe deal, from connecting your wallet to receiving your assets.
            </p>
          </div>
          <CreateDealButton className="shrink-0" />
        </div>
        <nav className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold">
          <a href="#how-it-works" className="text-accent hover:underline">How it works</a>
          {swapIntents && <a href="#settlement" className="text-accent hover:underline">Locked vs signed</a>}
          <a href="#safety" className="text-accent hover:underline">Safety checklist</a>
          <a href="#faq" className="text-accent hover:underline">FAQ</a>
        </nav>
      </section>

      <div className="grid gap-12 pt-10 lg:grid-cols-[12rem_1fr] lg:gap-16">
        <aside className="hidden lg:block">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">On this page</p>
          <nav className="mt-4 space-y-3 border-l border-black/10 pl-4 text-sm">
            <a href="#how-it-works" className="block text-muted hover:text-accent">How it works</a>
            {swapIntents && <a href="#settlement" className="block text-muted hover:text-accent">Locked vs signed</a>}
            <a href="#safety" className="block text-muted hover:text-accent">Safety checklist</a>
            <a href="#faq" className="block text-muted hover:text-accent">FAQ</a>
          </nav>
        </aside>

        <div className="min-w-0 space-y-14">
          <section id="how-it-works" className="scroll-mt-24">
            <div className="flex items-start gap-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-white">1</span>
              <div>
                <p className="text-sm font-semibold text-accent">The short version</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Four steps to a swap</h2>
              </div>
            </div>
            <div className="mt-7 divide-y divide-black/10 overflow-hidden rounded-xl border border-black/10 bg-white">
              {STEPS.map((step) => (
                <article key={step.number} className="grid gap-3 p-5 sm:grid-cols-[3rem_11rem_1fr] sm:items-start sm:gap-5 sm:p-6">
                  <span className="font-mono text-sm font-bold text-accent">{step.number}</span>
                  <h3 className="font-bold">{step.title}</h3>
                  <p className="text-sm leading-6 text-muted">{step.body}</p>
                </article>
              ))}
            </div>
          </section>

          {swapIntents && (
            <section id="settlement" className="scroll-mt-24">
              <div className="flex items-start gap-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-white">2</span>
                <div>
                  <p className="text-sm font-semibold text-accent">Choosing how it settles</p>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Locked deals vs signed swaps</h2>
                </div>
              </div>
              <p className="mt-5 max-w-3xl text-sm leading-6 text-muted">
                Every deal settles one of two ways, and you choose when you create it. A <strong>locked deal</strong> puts
                your side in the contract, so it&apos;s certain but ties up your assets. A <strong>signed swap</strong> is a
                message you sign: free and nothing is locked, but it&apos;s only as reliable as your wallet at the moment
                it settles. Both appear in the same list, tagged Locked or Signed.
              </p>

              <div className="mt-6 overflow-x-auto rounded-xl border border-black/10 bg-white">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/10 text-xs uppercase tracking-wider text-muted">
                      <th className="px-5 py-3 font-bold" />
                      <th className="px-5 py-3 font-bold">Lock assets now</th>
                      <th className="px-5 py-3 font-bold">Sign only</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/10">
                    {COMPARE.map(([row, locked, signed]) => (
                      <tr key={row} className="align-top">
                        <th scope="row" className="px-5 py-4 font-semibold whitespace-nowrap">{row}</th>
                        <td className="px-5 py-4 leading-6 text-muted">{locked}</td>
                        <td className="px-5 py-4 leading-6 text-muted">{signed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {(["escrow", "signed"] as const).map((mode) => (
                  <div key={mode} className="rounded-xl border border-black/10 bg-white p-5">
                    <h3 className="font-bold">{mode === "escrow" ? "Lock assets now" : "Sign only"}</h3>
                    <dl className="mt-4 space-y-4">
                      {termsFor(mode).map((term) => (
                        <div key={term.id} id={term.id} className="scroll-mt-24 target:rounded-lg target:bg-[#fff4cf] target:p-2 target:-m-2">
                          <dt className="flex items-center gap-1.5 text-sm font-semibold">
                            <span className={`font-black ${term.good ? "text-mint" : "text-warn"}`} aria-hidden>{term.good ? "+" : "−"}</span>
                            {term.label}
                          </dt>
                          <dd className="mt-1 text-sm leading-6 text-muted">{term.detail}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-sm text-muted">
                The design and settlement rules are written up in the project docs: ADR 0008 (signed swaps) and ADR 0009
                (rings).
              </p>
            </section>
          )}

          <section id="safety" className="scroll-mt-24 rounded-xl border border-black/10 bg-white p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-white">{swapIntents ? 3 : 2}</span>
              <div>
                <p className="text-sm font-semibold text-accent">Before you confirm</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Safety checklist</h2>
              </div>
            </div>
            <ul className="mt-7 grid gap-4 border-t border-black/10 pt-6 text-sm leading-6 text-muted sm:grid-cols-2">
              <li className="flex gap-3"><span className="font-bold text-mint">✓</span>Confirm Monad testnet and the expected wallet.</li>
              <li className="flex gap-3"><span className="font-bold text-mint">✓</span>Check every offered and requested token id.</li>
              <li className="flex gap-3"><span className="font-bold text-mint">✓</span>Direct offers are visible only to their named wallet.</li>
              <li className="flex gap-3"><span className="font-bold text-mint">✓</span>Never trust a contract address copied from an untrusted source.</li>
            </ul>
          </section>

          <section id="faq" className="scroll-mt-24">
            <div className="flex items-start gap-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-white">{swapIntents ? 4 : 3}</span>
              <div>
                <p className="text-sm font-semibold text-accent">Questions, answered</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Frequently asked questions</h2>
              </div>
            </div>
            <div className="mt-7 divide-y divide-black/10 rounded-xl border border-black/10 bg-white">
              {[...FAQ.slice(0, 1), ...(swapIntents ? SIGNED_FAQ : []), ...FAQ.slice(1)].map(([question, answer]) => (
                <details key={question} className="group px-5 sm:px-6">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-semibold">
                    {question}
                    <span className="text-xl font-normal text-accent transition-transform group-open:rotate-45" aria-hidden>+</span>
                  </summary>
                  <p className="pb-5 pr-8 text-sm leading-6 text-muted">{answer}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
