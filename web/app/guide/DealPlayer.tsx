"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LockIcon, SwapIcon, WalletIcon } from "@/components/Icons";
import { CARD, MUTED } from "./parts";

// One stage, two ways to settle. Each step only says where every asset sits, and CSS slides them there, so the
// difference shows itself: a locked deal moves your side into the contract at once, a signed swap leaves it in your
// wallet until the match. Words stay short and carry no amounts (docs/07-user-guide.md has the detail).

type Mode = "locked" | "signed";
type Tone = "nft" | "token";
type Kind = Tone | "fee" | "deal" | "sig";
type Piece = { id: string; kind: Kind; label: ReactNode };
type Place = { x: number; y: number; hidden?: boolean; dim?: boolean; badge?: string };
type Column = "you" | "mid" | "them";
type Step = {
  title: string;
  body: ReactNode;
  tags: string[];
  place: Record<string, Place>;
  /** Which box to light up. */
  focus?: Column;
  /** An alternative ending: it starts again from this step's layout instead of the one before it. */
  from?: number;
  /** The alternative ending's button: the question it answers. */
  ask?: string;
};
type Flow = { label: string; pieces: Piece[]; steps: Step[] };

// Stage coordinates, in percent of its width and height. Each wallet holds up to three assets in rows, its fee below.
const YOU = 14.5;
const MID = 50;
const THEM = 85.5;
const [R1, R2, R3] = [34, 48, 62];
const FEE = 74;
const CARD_Y = 18;
const at = (x: number, y: number): Place => ({ x, y });
const gone = (x: number, y: number): Place => ({ x, y, hidden: true });

/** A deal's sides as tiny squares, so a bundle fits on one card. */
function Bundle({ give, get }: { give: readonly Tone[]; get: readonly Tone[] }) {
  const squares = (tones: readonly Tone[]) => (
    <span className="flex gap-0.5">
      {tones.map((tone, i) => (
        <span key={i} className={`size-2.5 rounded-[3px] border border-[#111318] ${tone === "nft" ? "bg-peach" : "bg-mint"}`} />
      ))}
    </span>
  );
  return (
    <>
      {squares(give)}
      <span aria-hidden className="text-accent">
        →
      </span>
      {squares(get)}
    </>
  );
}

// You give two NFTs and a token; they give MON (WMON when signed) and an NFT.
const MINE: readonly Tone[] = ["nft", "nft", "token"];
const THEIRS: readonly Tone[] = ["token", "nft"];

const yours = (x: number) => ({ a1: at(x, R1), a2: at(x, R2), a3: at(x, R3) });
const theirs = (x: number) => ({ b1: at(x, R1), b2: at(x, R2) });
const PAID = { myFee: at(43, 92), theirFee: at(57, 92) };

const L0 = { ...yours(YOU), ...theirs(THEM), myFee: at(YOU, FEE), theirFee: at(THEM, FEE), card: gone(MID, CARD_Y) };
const L1 = { ...L0, ...yours(41), myFee: at(41, FEE), card: at(MID, CARD_Y) };
const L3 = { ...L1, ...theirs(59), theirFee: at(59, FEE) };

const LOCKED: Flow = {
  label: "Locked deal",
  pieces: [
    { id: "card", kind: "deal", label: <Bundle give={MINE} get={THEIRS} /> },
    { id: "myFee", kind: "fee", label: "fee" },
    { id: "theirFee", kind: "fee", label: "fee" },
    { id: "a1", kind: "nft", label: "NFT" },
    { id: "a2", kind: "nft", label: "NFT" },
    { id: "a3", kind: "token", label: "Token" },
    { id: "b1", kind: "token", label: "MON" },
    { id: "b2", kind: "nft", label: "NFT" },
  ],
  steps: [
    { title: "Before", body: "You have two NFTs and a token. You want their MON and their NFT.", tags: [], place: L0 },
    {
      title: "You create the deal",
      body: (
        <>
          You press <b>Create deal</b>. All three of your assets and your share of the fee move into the contract.
        </>
      ),
      tags: ["1 transaction", "you pay gas"],
      place: L1,
      focus: "mid",
    },
    {
      title: "It waits, locked",
      body: "It's listed in Deals, tagged Locked. Until it ends, the contract holds your assets, so you can't use or sell them.",
      tags: ["nothing to do", "can't fail later"],
      place: L1,
      focus: "mid",
    },
    {
      title: "Someone accepts",
      body: (
        <>
          They press <b>Accept &amp; swap</b>. Their MON, their NFT and their share of the fee go in.
        </>
      ),
      tags: ["1 transaction", "they pay gas"],
      place: L3,
      focus: "them",
    },
    {
      title: "Both sides move at once",
      body: "In that same transaction the contract hands each side everything the other gave, and the fee is paid. All or nothing.",
      tags: ["same transaction", "done"],
      place: { ...L3, ...yours(THEM), ...theirs(YOU), ...PAID, card: gone(MID, CARD_Y) },
    },
    {
      title: "Nobody accepts",
      body: (
        <>
          <b>Cancel deal</b> while it&apos;s open, or <b>Reclaim my assets</b> once it expires. Everything comes back, fee included.
        </>
      ),
      tags: ["1 transaction", "fee refunded"],
      place: L0,
      focus: "you",
      from: 2,
      ask: "What if nobody accepts?",
    },
  ],
};

const S0 = { ...yours(YOU), ...theirs(THEM), myFee: at(YOU, FEE), theirFee: at(THEM, FEE), mine: gone(YOU, 30), theirs: gone(THEM, 48) };
const S1 = { ...S0, mine: at(MID, 30) };
const S3 = { ...S1, theirs: at(MID, 48) };

const SIGNED: Flow = {
  label: "Signed swap",
  pieces: [
    { id: "mine", kind: "sig", label: <Bundle give={MINE} get={THEIRS} /> },
    { id: "theirs", kind: "sig", label: <Bundle give={THEIRS} get={MINE} /> },
    { id: "myFee", kind: "fee", label: "fee" },
    { id: "theirFee", kind: "fee", label: "fee" },
    { id: "a1", kind: "nft", label: "NFT" },
    { id: "a2", kind: "nft", label: "NFT" },
    { id: "a3", kind: "token", label: "Token" },
    { id: "b1", kind: "token", label: "WMON" },
    { id: "b2", kind: "nft", label: "NFT" },
  ],
  steps: [
    { title: "Before", body: "You have two NFTs and a token. You want their WMON and their NFT.", tags: [], place: S0 },
    {
      title: "You sign",
      body: "First you approve what you give, and your fee in WMON (the steps wrap MON if you're short). Then you sign what you give and what you want. Only the signed message goes to the pool; your assets and fee don't move.",
      tags: ["signing is free", "approvals cost gas"],
      place: S1,
      focus: "you",
    },
    {
      title: "It waits in the pool",
      body: "It's listed in Deals, tagged Signed. Your assets stay in your wallet. Keep all three there, with their approvals, until a match.",
      tags: ["nothing locked", "removing it is free"],
      place: S1,
      focus: "you",
    },
    {
      title: "Someone signs the other side",
      body: (
        <>
          On your swap&apos;s page, <b>Create a matching swap</b> fills in the mirror for them: give WMON and an NFT, get your three.
        </>
      ),
      tags: ["a message", "free"],
      place: S3,
      focus: "them",
    },
    {
      title: "A matcher settles both",
      body: "It finds the pair and sends one transaction. Every asset moves straight from wallet to wallet, and the fee comes out only now.",
      tags: ["1 transaction, by the matcher", "done"],
      place: { ...S3, mine: gone(MID, 39), theirs: gone(MID, 39), ...yours(THEM), ...theirs(YOU), ...PAID },
      focus: "mid",
    },
    {
      title: "One asset leaves first",
      body: "Sell or move just one of them, let the WMON for your fee run short, or revoke an approval, and a match can't settle. Nobody loses anything, and your swap shows as Paused until you fix it.",
      tags: ["no swap", "nothing lost"],
      place: { ...S1, a2: gone(YOU, 96), mine: { ...at(MID, 30), dim: true, badge: "Paused" } },
      focus: "you",
      from: 2,
      ask: "What if one asset leaves first?",
    },
  ],
};

const FLOWS: Record<Mode, Flow> = { locked: LOCKED, signed: SIGNED };

const PIECE: Record<Kind, string> = {
  nft: "h-7 min-w-10 rounded-md bg-peach px-1 text-[10px]",
  token: "h-7 min-w-10 rounded-md bg-mint px-1 text-[10px]",
  fee: "h-6 rounded-full bg-white px-2 text-[10px]",
  deal: "h-7 gap-1 rounded-lg bg-[#fff4cf] px-1.5 text-[10px] whitespace-nowrap",
  sig: "h-7 gap-1 rounded-lg border-dashed bg-[#fff4cf] px-1.5 text-[10px] whitespace-nowrap",
};

/** One box on the stage. */
function Box({ column, label, icon, dark = false, lit }: { column: Column; label: string; icon: ReactNode; dark?: boolean; lit: boolean }) {
  // The middle box is wider: it holds both sides' cards, which run longer than a single asset.
  const [left, width] = { you: ["1%", "27%"], mid: ["31.5%", "37%"], them: ["72%", "27%"] }[column];
  return (
    <div
      style={{ left, width }}
      className={`absolute top-0 h-[80%] rounded-xl border-2 border-[#111318] p-2 transition-[outline-color] duration-500 ${
        dark ? "bg-[#111318] text-white" : column === "mid" ? "border-dashed bg-white/40" : "bg-white/70"
      } outline-3 outline-offset-2 ${lit ? "outline-accent" : "outline-transparent"}`}
    >
      <p className="flex items-center gap-1 text-[10px] font-black tracking-wider uppercase">
        {icon}
        {label}
      </p>
    </div>
  );
}

export function DealPlayer({ signed }: { signed: boolean }) {
  const [mode, setMode] = useState<Mode>("locked");
  const [step, setStep] = useState(0);
  const [instant, setInstant] = useState(false);
  const [playing, setPlaying] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  const flow = FLOWS[mode];
  const current = flow.steps[step];
  // The last step is the alternative ending; the one before it ends the happy path.
  const end = flow.steps.length - 2;

  // Play once the stage is mostly on screen, unless the viewer asked for less motion.
  useEffect(() => {
    const el = stage.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setPlaying(true);
        io.disconnect();
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || step >= end) return;
    const timer = setTimeout(
      () => {
        setStep(step + 1);
        if (step + 1 >= end) setPlaying(false);
      },
      step === 0 ? 900 : 2600,
    );
    return () => clearTimeout(timer);
  }, [playing, step, end]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** Go to a step. A new mode or an alternative ending first snaps, unanimated, to the layout it starts from. */
  function jump(next: number, nextMode: Mode = mode) {
    cancelAnimationFrame(frame.current);
    const start = nextMode !== mode ? 0 : FLOWS[nextMode].steps[next].from;
    if (start === undefined || (start === step && nextMode === mode)) {
      setInstant(false);
      setStep(next);
      return;
    }
    setInstant(true);
    setMode(nextMode);
    setStep(start);
    // Two frames, so the snapped layout is painted before the move to `next` animates from it.
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => {
        setInstant(false);
        setStep(next);
      });
    });
  }

  function go(next: number) {
    setPlaying(false);
    jump(next);
  }

  function play() {
    if (playing) return setPlaying(false);
    if (step >= end) jump(0);
    setPlaying(true);
  }

  const alt = current.from !== undefined;
  const altStep = flow.steps[end + 1];
  const control = "grid h-8 min-w-8 place-items-center rounded-full border-2 border-[#111318] bg-white px-2 text-sm font-black disabled:opacity-40";

  return (
    <figure className={`${CARD} space-y-4 p-3 sm:p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {signed ? (
          <div role="group" aria-label="Kind of deal" className="flex rounded-full border-2 border-[#111318] bg-white p-0.5">
            {(Object.keys(FLOWS) as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => {
                  setPlaying(false);
                  if (m !== mode) jump(0, m);
                }}
                className={`rounded-full px-3 py-1 text-sm font-black ${mode === m ? "bg-[#111318] text-white" : ""}`}
              >
                {FLOWS[m].label}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm font-black">{flow.label}</p>
        )}
        <div className="flex items-center gap-1.5">
          <button type="button" className={control} aria-label="Previous step" disabled={step === 0} onClick={() => go(alt ? (current.from ?? 0) : step - 1)}>
            ‹
          </button>
          <button type="button" className={`${control} px-3`} onClick={play}>
            {playing ? "Pause" : step >= end ? "Replay" : "▶ Play"}
          </button>
          <button type="button" className={control} aria-label="Next step" disabled={alt} onClick={() => go(step + 1)}>
            ›
          </button>
        </div>
      </div>

      <div ref={stage} aria-hidden className="relative mx-auto h-72 max-w-xl sm:h-80">
        <Box column="you" label="You" icon={<WalletIcon className="size-3" />} lit={current.focus === "you"} />
        {mode === "locked" ? (
          <Box column="mid" label="Contract" icon={<LockIcon className="size-3" />} dark lit={current.focus === "mid"} />
        ) : (
          <Box column="mid" label="Pool" icon={<SwapIcon className="size-3" />} lit={current.focus === "mid"} />
        )}
        <Box column="them" label="Them" icon={<WalletIcon className="size-3" />} lit={current.focus === "them"} />
        <div className="absolute inset-x-[32%] top-[85%] bottom-0 grid place-items-center rounded-full border-2 border-dashed border-[#111318]/30 text-[10px] font-black tracking-wider text-[#4e5968] uppercase">
          {current.place.myFee.y < 85 && "Fees"}
        </div>

        {flow.pieces.map((piece) => {
          const p = current.place[piece.id];
          return (
            <div
              key={`${mode}-${piece.id}`}
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                transform: `translate(-50%, -50%) scale(${p.hidden ? 0.5 : 1})`,
                opacity: p.hidden ? 0 : p.dim ? 0.45 : 1,
              }}
              className={`absolute flex items-center justify-center border-2 border-[#111318] font-black text-[#111318] ${PIECE[piece.kind]} ${
                instant ? "transition-none" : "transition-all duration-700 ease-in-out motion-reduce:transition-none"
              }`}
            >
              {piece.kind === "deal" && <LockIcon className="size-3" />}
              {piece.kind === "sig" && <span>✍</span>}
              {piece.label}
              {p.badge && <span className="absolute -top-2.5 -right-2 rounded-full bg-[#111318] px-1.5 py-0.5 text-[9px] text-white">{p.badge}</span>}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {flow.steps.slice(0, end + 1).map((s, i) => (
          <button
            key={s.title}
            type="button"
            aria-label={s.title}
            aria-current={i === step ? "step" : undefined}
            onClick={() => go(i)}
            className={`h-7 min-w-7 rounded-full border-2 border-[#111318] px-2 text-xs font-black ${i === step ? "bg-accent text-white" : "bg-white"}`}
          >
            {i === 0 ? "Start" : i}
          </button>
        ))}
        {/* Called out once the happy path has played, so the ending that keeps your assets safe isn't missed. */}
        <button
          type="button"
          aria-current={alt ? "step" : undefined}
          onClick={() => go(end + 1)}
          className={`ml-auto h-8 rounded-full border-2 px-3 text-sm font-black transition-colors ${
            alt
              ? "border-[#111318] bg-[#111318] text-white"
              : step === end && !playing
                ? "border-[#111318] bg-accent text-white"
                : "border-dashed border-accent bg-white text-accent"
          }`}
        >
          {altStep.ask} <span aria-hidden>→</span>
        </button>
      </div>

      <figcaption aria-live="polite" className="min-h-32 border-t border-[#111318]/10 pt-4">
        <p className="text-xs font-black tracking-wider text-accent uppercase">{alt ? "Another ending" : step === 0 ? "Start" : `Step ${step} of ${end}`}</p>
        <h4 className="mt-1 text-lg font-black">{current.title}</h4>
        {current.tags.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-1.5">
            {current.tags.map((tag) => (
              <span key={tag} className="rounded-full border-2 border-[#111318] bg-white px-2 py-0.5 text-xs font-bold">
                {tag}
              </span>
            ))}
          </p>
        )}
        <p className={`mt-2 text-sm leading-6 ${MUTED}`}>{current.body}</p>
      </figcaption>
    </figure>
  );
}
