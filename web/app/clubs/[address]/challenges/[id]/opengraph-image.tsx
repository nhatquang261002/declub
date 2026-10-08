import { ImageResponse } from "next/og";
import { placeWord } from "@/lib/challengeShare";
import { countdown } from "@/lib/format";
import { readChallengeFacts, type CardWinner, type ChallengeFacts } from "@/lib/server/challengeCard";
import { Avatar, BLUE, CARD_SIZE, cardFonts, CardFrame, CREAM, GREEN, INK, Pill, publicImage, YELLOW } from "@/lib/server/cardKit";

export const alt = "A Club challenge on DeClub";
export const size = CARD_SIZE;
export const contentType = "image/png";
// A challenge closes, is judged and settles, and the store is read per request.
export const dynamic = "force-dynamic";

/** Gold, silver and bronze, as on the challenge's prize tiles. */
const MEDAL = ["#f0b735", "#c9ced6", "#d9925b"];
/** How tall each place's step is: 1st highest. */
const STEP = [128, 96, 72];

/**
 * A long title shrinks so it stays on the card in two lines at most (titles are at most 60
 * characters); `small` leaves room for a grid of winners under it.
 */
const fit = (text: string, small: boolean) => (small ? (text.length > 40 ? 40 : text.length > 24 ? 48 : 56) : text.length > 40 ? 46 : text.length > 24 ? 56 : 68);

function Title({ text, small = false }: { text: string; small?: boolean }) {
  return <div style={{ display: "flex", fontSize: fit(text, small), lineHeight: 1.08, marginTop: small ? 10 : 14 }}>“{text}”</div>;
}

/** One step of the podium: the winner's name over a medal-coloured block with their place. */
function Step({ winner }: { winner: CardWinner }) {
  const i = Math.min(winner.place, 3) - 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 300 }}>
      <div style={{ display: "flex", maxWidth: 290, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontSize: 32, marginBottom: 8 }}>{winner.name}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 260, height: STEP[i], borderTop: `5px solid ${INK}`, borderLeft: `5px solid ${INK}`, borderRight: `5px solid ${INK}`, borderRadius: "16px 16px 0 0", background: MEDAL[i], fontSize: 40 }}>
        {placeWord(winner.place).toUpperCase()}
      </div>
    </div>
  );
}

/** The podium: 2nd, 1st, 3rd from the left, standing on one line. */
function Podium({ winners }: { winners: CardWinner[] }) {
  const order = [winners.find((w) => w.place === 2), winners.find((w) => w.place === 1), winners.find((w) => w.place === 3)].filter((w): w is CardWinner => !!w);
  return (
    <div style={{ display: "flex", flex: 1, alignItems: "flex-end", justifyContent: "center", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-end", borderBottom: `6px solid ${INK}` }}>
        {order.map((w) => (
          <Step key={w.place} winner={w} />
        ))}
      </div>
    </div>
  );
}

/** A winner's dot: a colour picked from their wallet, so the same wallet always gets the same one. */
const DOTS = [YELLOW, GREEN, "#9fb8e6", "#f2a7a0", "#c9b6f2", "#f6c48f"];
const dotOf = (wallet: string) => DOTS[parseInt(wallet.slice(-6), 16) % DOTS.length] ?? YELLOW;

/** Each cell of the winners' grid: two columns of three. */
const CELL = { display: "flex", alignItems: "center", gap: 14, width: 352, height: 50, border: `4px solid ${INK}`, borderRadius: 16, padding: "0 18px", fontSize: 28 } as const;

/**
 * Winners who share one prize (a raffle, first in, everyone who completes): a gold tile with how
 * many won and what each got, beside a grid of up to six names; past six, the last cell says how
 * many more.
 */
function Winners({ c }: { c: ChallengeFacts }) {
  const full = c.winnerCount > c.winners.length;
  const named = full ? c.winners.slice(0, 5) : c.winners;
  const more = c.winnerCount - named.length;
  return (
    <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 28, margin: "14px 0 18px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 230, height: 174, border: `5px solid ${INK}`, borderRadius: 24, background: MEDAL[0] }}>
        <div style={{ display: "flex", fontSize: 80, lineHeight: 1 }}>{c.winnerCount}</div>
        <div style={{ display: "flex", fontSize: 24, letterSpacing: 4, marginTop: 4 }}>{c.winnerCount === 1 ? "WINNER" : "WINNERS"}</div>
        {c.prize > 0 && <div style={{ display: "flex", fontSize: 22, letterSpacing: 2, marginTop: 10, color: BLUE }}>{`+${c.prize} PTS EACH`}</div>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", width: 720, gap: 12 }}>
        {named.map((w) => (
          <div key={w.wallet} style={{ ...CELL, background: "white" }}>
            <div style={{ display: "flex", flexShrink: 0, width: 26, height: 26, borderRadius: 999, border: `3px solid ${INK}`, background: dotOf(w.wallet) }} />
            <div style={{ display: "flex", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{w.name}</div>
          </div>
        ))}
        {more > 0 && full && <div style={{ ...CELL, justifyContent: "center", background: CREAM, color: BLUE }}>{`+${more} more`}</div>}
      </div>
    </div>
  );
}

/** One fact of an open challenge: a small label over a big value. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, border: `4px solid ${INK}`, borderRadius: 20, background: "white", padding: "12px 24px" }}>
      <div style={{ display: "flex", fontSize: 22, letterSpacing: 3, color: BLUE }}>{label}</div>
      <div style={{ display: "flex", fontSize: 44, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

/** What an open challenge pays: "+10 / +5 / +2 pts", or "+3 pts × 5" when every winner gets the same. */
function prizeLine(c: ChallengeFacts): string {
  if (!c.flat) return `${c.prizes.map((p) => `+${p}`).join(" / ")} pts`;
  return c.prize > 0 ? `+${c.prize} pts × ${c.places}` : `${c.places} ${c.places === 1 ? "winner" : "winners"}`;
}

/** The sentence a challenge without winners to show ends on. */
function neutralLine(c: ChallengeFacts | null): string {
  if (!c) return "Post about the Club on X, win its challenges.";
  if (c.phase === "closing" || c.phase === "judging") return "It has ended: the results are coming.";
  if (c.phase === "cancelled") return "Called off by the Owner.";
  return "Finished, with no winner this time.";
}

export default async function Image({ params }: { params: Promise<{ address: string; id: string }> }) {
  const { address, id } = await params;
  const now = Date.now();
  const [facts, fonts] = await Promise.all([readChallengeFacts(address, id, now), cardFonts()]);
  const avatar = await publicImage(facts?.image);
  const c = facts?.challenge ?? null;
  const results = c?.phase === "settled" && c.winners.length > 0;
  const open = c?.phase === "open";
  return new ImageResponse(
    (
      <CardFrame
        footer="Post about it. Win the challenge."
        badge={<Pill fill={results ? GREEN : open ? YELLOW : CREAM}>{results ? "CHALLENGE RESULTS" : "CHALLENGE"}</Pill>}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 22 }}>
          {facts && <Avatar src={avatar} name={facts.club} size={64} />}
          <div style={{ display: "flex", fontSize: 36 }}>{facts ? `${facts.club} Club` : "A Club on Monad"}</div>
        </div>
        {c && <Title text={c.title} small={results && c.flat} />}
        {c && results ? (
          c.flat ? <Winners c={c} /> : <Podium winners={c.winners} />
        ) : c && open ? (
          <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 20, marginBottom: 18 }}>
            <Stat label={c.flat ? "PRIZE" : "PRIZES"} value={prizeLine(c)} />
            <Stat label="ENDS IN" value={countdown(Math.floor((c.endsAt - now) / 1000))} />
            <Stat label="ENTRIES" value={String(c.entryCount)} />
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, alignItems: "center", marginBottom: 18, fontSize: c ? 40 : 54, lineHeight: 1.1 }}>{neutralLine(c)}</div>
        )}
      </CardFrame>
    ),
    { ...size, fonts },
  );
}
