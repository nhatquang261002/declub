import type { ReactNode } from "react";
import { LockIcon, ShieldIcon, SwapIcon, WalletIcon } from "@/components/Icons";
import { CARD, MUTED } from "./parts";

// How each kind of deal goes from creation to a settled swap, in four pictures. Plain markup, no script, so it
// prints and reads the same on a phone. The words stay short and carry no amounts (docs/07-user-guide.md has the detail).

type Tone = "nft" | "token";
type Step = { title: string; body: ReactNode; art: ReactNode };

/** A stand-in asset: an NFT or a token, in the colours the deal pages use. */
function Tile({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`grid h-9 min-w-12 place-items-center rounded-lg border-2 border-[#111318] px-2 text-xs font-black ${tone === "nft" ? "bg-peach" : "bg-mint"}`}
    >
      {children}
    </span>
  );
}

/** A labelled box with whatever sits in it: a wallet, or (dark) the contract. */
function Box({ label, contract = false, children }: { label: string; contract?: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-xl border-2 border-[#111318] p-2.5 ${contract ? "bg-[#111318] text-white" : "bg-white/70"}`}>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-black tracking-wider uppercase">
        {contract ? <LockIcon className="size-3.5" /> : <WalletIcon className="size-3.5" />}
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** One deal as a line: what is given, then what is wanted back. Dashed and signed for a signed swap. */
function Note({ give, want, signed = false, dim = false }: { give: ReactNode; want: ReactNode; signed?: boolean; dim?: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg border-2 border-[#111318] bg-[#fff4cf] px-2 py-1.5 text-xs font-black ${signed ? "border-dashed" : ""} ${dim ? "opacity-60" : ""}`}
    >
      <span aria-hidden>{signed ? "✍" : <LockIcon className="size-3" />}</span>
      {give}
      <span aria-hidden className="text-accent">
        →
      </span>
      {want}
    </div>
  );
}

const Stays = () => <span className="text-xs font-bold text-[#1f7a55]">stays here</span>;

/** Both wallets after settlement: each holds what the other gave. Stacked, so it fits a quarter-width card. */
function Settled({ mine, theirs }: { mine: ReactNode; theirs: ReactNode }) {
  const got = <span className="text-xs font-bold text-[#1f7a55]">received</span>;
  return (
    <>
      <Box label="You">
        {mine}
        {got}
      </Box>
      <Box label="Them">
        {theirs}
        {got}
      </Box>
    </>
  );
}

function StepStrip({ steps, caption }: { steps: readonly Step[]; caption: ReactNode }) {
  return (
    <figure className="space-y-4">
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <li key={step.title} className={`${CARD} relative flex flex-col gap-3 p-4`}>
            <span className="grid size-7 place-items-center rounded-full border-2 border-[#111318] bg-accent text-sm font-black text-white">{i + 1}</span>
            <div className="min-h-28 space-y-2">{step.art}</div>
            <div>
              <h4 className="font-black">{step.title}</h4>
              <p className={`mt-1 text-sm leading-6 ${MUTED}`}>{step.body}</p>
            </div>
            {i < steps.length - 1 && (
              <span aria-hidden className="absolute top-1/2 -right-3.5 z-10 hidden -translate-y-1/2 text-xl font-black text-accent lg:block">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
      <figcaption className="flex items-start gap-2.5 rounded-xl border-2 border-dashed border-[#111318]/30 p-4 text-sm leading-6">
        <ShieldIcon className="mt-0.5 size-5 shrink-0 text-[#1f7a55]" />
        <span>{caption}</span>
      </figcaption>
    </figure>
  );
}

const LOCKED: readonly Step[] = [
  {
    title: "You lock your side",
    body: (
      <>
        Pick what you give and what you want, then <b>Create deal</b>. Your side and your share of the fee move into the contract.
      </>
    ),
    art: (
      <>
        <Box label="You">
          <span className="text-xs font-bold text-[#4e5968]">NFT sent</span>
        </Box>
        <Box label="Contract" contract>
          <Tile tone="nft">NFT</Tile>
          <span className="text-xs font-bold">+ fee</span>
        </Box>
      </>
    ),
  },
  {
    title: "It's listed",
    body: "Your deal shows up in Deals, tagged Locked, for anyone or only the wallet you named.",
    art: (
      <Box label="Contract" contract>
        <div className="space-y-1.5 text-[#111318]">
          <Note give="NFT" want="MON" />
          <Note give="Token" want="NFT" dim />
        </div>
      </Box>
    ),
  },
  {
    title: "Someone accepts",
    body: (
      <>
        They press <b>Accept &amp; swap</b>. Their side and their share of the fee go in that same transaction.
      </>
    ),
    art: (
      <>
        <Box label="Them">
          <Tile tone="token">MON</Tile>
          <span className="text-xs font-bold text-accent">sends now</span>
        </Box>
        <Note give="MON" want="NFT" />
      </>
    ),
  },
  {
    title: "Both sides move at once",
    body: "The contract hands each side what the other gave, in one transaction. It can't fail halfway.",
    art: <Settled mine={<Tile tone="token">MON</Tile>} theirs={<Tile tone="nft">NFT</Tile>} />,
  },
];

const SIGNED: readonly Step[] = [
  {
    title: "You sign",
    body: "Pick what you give and what you want. You sign a message, not a transaction. Your assets stay in your wallet.",
    art: (
      <>
        <Box label="You">
          <Tile tone="nft">NFT</Tile>
          <Stays />
        </Box>
        <Note give="NFT" want="WMON" signed />
      </>
    ),
  },
  {
    title: "The pool lists it",
    body: "Your signed swap joins the pool and shows up in Deals, tagged Signed. Removing it is free.",
    art: (
      <div className="rounded-xl border-2 border-[#111318] bg-white/70 p-2.5">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-black tracking-wider uppercase">
          <SwapIcon className="size-3.5" />
          Pool
        </p>
        <div className="space-y-1.5">
          <Note give="NFT" want="WMON" signed />
          <Note give="Token" want="NFT" signed dim />
        </div>
      </div>
    ),
  },
  {
    title: "Someone signs the other side",
    body: (
      <>
        On your swap&apos;s page, <b>Create a matching swap</b> fills in the mirror: they give what you want and want what you give.
      </>
    ),
    art: (
      <>
        <Box label="Them">
          <Tile tone="token">WMON</Tile>
          <Stays />
        </Box>
        <Note give="WMON" want="NFT" signed />
      </>
    ),
  },
  {
    title: "A matcher settles both",
    body: "It finds the pair and sends one transaction. Both sides move together, and the fee comes out only now.",
    art: <Settled mine={<Tile tone="token">WMON</Tile>} theirs={<Tile tone="nft">NFT</Tile>} />,
  },
];

export function LockedDealVisual() {
  return (
    <StepStrip
      steps={LOCKED}
      caption={
        <>
          <b>Nobody accepted?</b> <b>Cancel deal</b> while it&apos;s open, or <b>Reclaim my assets</b> once it expires. Everything comes back to you, fee
          included.
        </>
      }
    />
  );
}

export function SignedSwapVisual() {
  return (
    <StepStrip
      steps={SIGNED}
      caption={
        <>
          <b>Missing something when the match runs?</b> If an asset moved or an approval is gone, the whole settlement is refused and nobody loses anything.
          Your swap shows as Paused until you fix it.
        </>
      }
    />
  );
}
