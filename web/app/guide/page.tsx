import Link from "next/link";
import { PageHeader } from "@/components/Page";
import { ChogSwapArt } from "@/components/ChogArt";

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
    <div className="space-y-14">
      <section className="max-w-3xl">
        <div className="eyebrow">On Deal field guide</div>
        <PageHeader title="Trade with confidence." />
        <p className="max-w-2xl text-lg leading-8 text-muted">
          Everything you need to make a safe Chog trade: how the flow works, what approval means,
          and what happens to your assets at every step.
        </p>
      </section>

      <section className="page-section overflow-hidden p-2 sm:p-3">
        <ChogSwapArt compact />
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="label">The short version</p>
            <h2 className="text-2xl font-bold">Four steps to a swap</h2>
          </div>
          <Link href="/create" className="btn-primary hidden sm:inline-flex">Create a trade ↗</Link>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {STEPS.map((step) => (
            <article key={step.number} className="card p-5">
              <span className="font-mono text-sm font-bold text-accent">{step.number}</span>
              <h3 className="mt-3 text-lg font-bold">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="page-section p-6 sm:p-8">
        <p className="label">Safety checklist</p>
        <h2 className="text-2xl font-bold">Before you confirm</h2>
        <ul className="mt-5 grid gap-3 text-sm leading-6 text-muted sm:grid-cols-2">
          <li>✓ Confirm you are on Monad testnet and using the expected wallet.</li>
          <li>✓ Check every offered and requested token id before signing.</li>
          <li>✓ Remember that a direct offer is visible only to its named wallet.</li>
          <li>✓ Never approve or send assets to a contract address copied from an untrusted source.</li>
        </ul>
      </section>

      <section>
        <div className="mb-5">
          <p className="label">Questions, answered</p>
          <h2 className="text-2xl font-bold">FAQ</h2>
        </div>
        <div className="space-y-3">
          {FAQ.map(([question, answer]) => (
            <details key={question} className="card group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 font-semibold">
                {question}
                <span className="text-xl text-accent transition-transform group-open:rotate-45" aria-hidden>+</span>
              </summary>
              <p className="border-t border-line px-5 py-4 text-sm leading-6 text-muted">{answer}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
