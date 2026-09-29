import Link from "next/link";

const STEPS = [
  {
    number: "01",
    title: "Connect your wallet",
    body: "Use an injected wallet such as MetaMask or Rabby, and switch to Monad testnet. You will need test MON for gas and any MON you include in a trade.",
  },
  {
    number: "02",
    title: "Create an offer",
    body: "Choose the Chogs you want to give, then enter the Chog ids or MON you want in return. You can make the offer public or address it to one wallet.",
  },
  {
    number: "03",
    title: "Approve and lock",
    body: "Approve On Deal once so it can escrow your offered Chogs. Creating the trade then locks your side in the contract immediately.",
  },
  {
    number: "04",
    title: "Accept a trade",
    body: "Open a trade where you own every requested Chog. Approve the collection if needed, then Accept & Swap. The contract settles both sides atomically.",
  },
];

const FAQ = [
  ["What is On Deal?", "On Deal is a peer-to-peer, non-custodial way to trade Chogs. The smart contract holds the maker's side and settles the exchange only when the taker provides the requested side."],
  ["Do I have to trust the other trader?", "No. The swap is atomic: either every NFT and MON transfer succeeds, or the transaction reverts. The other trader never receives your escrowed assets without sending their side."],
  ["What does escrow mean here?", "When you create an open trade, the Chogs you offer move into the On Deal contract. They remain there until the trade is filled, cancelled by you, or reclaimed after expiry."],
  ["Can I cancel my trade?", "Yes. The maker can cancel any open trade before it is filled. Your escrowed Chogs and offered MON are returned to your wallet."],
  ["What happens when a trade expires?", "An expired trade cannot be filled. The maker, or another wallet on the maker's behalf, can call Reclaim to return the escrowed assets."],
  ["Who can accept a trade?", "Public trades can be accepted by any wallet that owns all requested Chogs. A direct trade can only be accepted by the wallet named by the maker."],
  ["Are there platform fees?", "On Deal has no platform fee. You only pay the Monad transaction cost, plus any MON intentionally included in the trade."],
  ["Why do I need to approve On Deal?", "ERC-721 collections require your permission before a contract can transfer your NFTs. Approval is a one-time collection-wide permission for this swap contract."],
  ["Is this mainnet?", "The current demo runs on Monad testnet with MockChog. Treat test assets as disposable and never send valuable NFTs to an unfamiliar contract."],
];

export default function GuidePage() {
  return (
    <div className="pb-10">
      <section className="border-b border-black/10 pb-10 pt-4 sm:pb-12">
        <p className="text-sm font-semibold text-accent">Documentation / Guide</p>
        <div className="mt-4 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div>
            <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">How to trade on On Deal</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg">
              Everything you need to make a safe Chog trade, from connecting your wallet to receiving your assets.
            </p>
          </div>
          <Link href="/create" className="btn-primary shrink-0">Create a trade ↗</Link>
        </div>
        <nav className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold">
          <a href="#how-it-works" className="text-accent hover:underline">How it works</a>
          <a href="#safety" className="text-accent hover:underline">Safety checklist</a>
          <a href="#faq" className="text-accent hover:underline">FAQ</a>
        </nav>
      </section>

      <div className="grid gap-12 pt-10 lg:grid-cols-[12rem_1fr] lg:gap-16">
        <aside className="hidden lg:block">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">On this page</p>
          <nav className="mt-4 space-y-3 border-l border-black/10 pl-4 text-sm">
            <a href="#how-it-works" className="block text-muted hover:text-accent">How it works</a>
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

          <section id="safety" className="scroll-mt-24 rounded-xl border border-black/10 bg-white p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-white">2</span>
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
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-white">3</span>
              <div>
                <p className="text-sm font-semibold text-accent">Questions, answered</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Frequently asked questions</h2>
              </div>
            </div>
            <div className="mt-7 divide-y divide-black/10 rounded-xl border border-black/10 bg-white">
              {FAQ.map(([question, answer]) => (
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
