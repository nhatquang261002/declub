import { ImageResponse } from "next/og";
import { readDealFacts } from "@/lib/server/dealCard";
import type { CardItem, DealFacts } from "@/lib/dealShare";
import { Avatar, BLUE, CARD_SIZE, cardFonts, CardFrame, CREAM, GREEN, INK, PINK, Pill, publicImage, YELLOW } from "@/lib/server/cardKit";

export const alt = "A deal on De(al) Club";
export const size = CARD_SIZE;
export const contentType = "image/png";
// A deal's status changes (open, filled), and the chain is read per request.
export const dynamic = "force-dynamic";

const STATUS: Record<DealFacts["status"], string> = { open: "OPEN", filled: "SWAPPED", cancelled: "CANCELLED", expired: "EXPIRED" };

/** More than this many assets on a side and the rest become "+N more". */
const MAX_SHOWN = 3;

/** How big a picture is for how many share the side, and how they fan out. */
const PHOTO = [0, 196, 152, 94];
/** The space between neighbours: they sit apart so each one's name and number stay readable. */
const GAP = [0, 0, 28, 16];
const TILT = [[], [-6], [-6, 5], [-6, 3, -4]];

/** A polaroid like the home page's: a white frame, the picture, the name, and the token number in a pill. */
function Polaroid({ item, art, mon, photo, tilt, overlap }: { item: CardItem; art: string | null; mon: string | null; photo: number; tilt: number; overlap: number }) {
    return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", width: photo + 28, marginLeft: overlap, padding: "14px 14px 12px", borderRadius: 8, background: "white", boxShadow: "0 16px 34px #1b103d4d, 0 2px 6px #1b103d33", transform: `rotate(${tilt}deg)` }}>
      <div style={{ display: "flex", position: "absolute", top: -12, left: "50%", marginLeft: -34, width: 68, height: 22, background: "#fdf6cdf2", border: `2px solid ${INK}33`, transform: "rotate(-3deg)" }} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: photo, height: photo, overflow: "hidden", border: `2px solid ${INK}33`, borderRadius: 3, background: "#fff4cf" }}>
        {art ? (
          <img src={art} width={photo} height={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : item.amount ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            {item.native && mon && <img src={mon} width={photo * 0.3} height={photo * 0.3} alt="" />}
            <div style={{ display: "flex", fontSize: photo * (item.amount.length > 6 ? 0.18 : 0.26) }}>{item.amount}</div>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: photo * 0.5 }}>{(item.name.match(/[\p{L}\p{N}]/u)?.[0] ?? "•").toUpperCase()}</div>
        )}
      </div>
      <div style={{ display: "flex", marginTop: 10, width: photo, overflow: "hidden", textOverflow: "ellipsis", fontSize: photo > 150 ? 24 : 18, letterSpacing: 1, whiteSpace: "nowrap" }}>{item.name.toUpperCase()}</div>
      {item.id && (
        <div style={{ display: "flex", position: "absolute", top: -16, right: -18, border: `3px solid ${INK}`, borderRadius: 12, background: CREAM, padding: "2px 12px", fontSize: photo > 200 ? 28 : 22 }}>{item.id}</div>
      )}
    </div>
  );
}

/** What an open offer asks for instead of assets: a card with the words. */
function Words({ text, photo }: { text: string; photo: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", position: "relative", padding: "14px", borderRadius: 8, background: "white", boxShadow: "0 16px 34px #1b103d4d, 0 2px 6px #1b103d33", transform: "rotate(6deg)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: photo, height: photo, padding: 24, textAlign: "center", border: `2px solid ${INK}33`, borderRadius: 3, background: "#ffe3d8", fontSize: 44, lineHeight: 1.1 }}>{text}</div>
    </div>
  );
}

function Side({ label, items, images, mon, words }: { label: string; items: CardItem[]; images: Map<string, string | null>; mon: string | null; words?: string }) {
  const shown = items.slice(0, MAX_SHOWN);
  const more = items.length - shown.length;
  const photo = PHOTO[Math.max(1, shown.length)];
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, alignItems: "center" }}>
      <div style={{ display: "flex", fontSize: 26, letterSpacing: 4 }}>{label}</div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", position: "relative" }}>
        {words ? (
          <Words text={words} photo={PHOTO[1]} />
        ) : (
          shown.map((item, i) => (
            <Polaroid key={i} item={item} art={item.image ? (images.get(item.image) ?? null) : null} mon={mon} photo={photo} tilt={TILT[shown.length][i]} overlap={i === 0 ? 0 : GAP[shown.length]} />
          ))
        )}
        {more > 0 && (
          <div style={{ display: "flex", position: "absolute", right: 4, bottom: 2, border: `4px solid ${INK}`, borderRadius: 999, background: YELLOW, padding: "6px 18px", fontSize: 28 }}>+{more} more</div>
        )}
      </div>
    </div>
  );
}

/** Two round arrows, one each way, like the home page's swap: drawn, since the font has no arrows. */
function Arrows() {
  const arrow = (d: string, tilt: number) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, border: `4px solid ${INK}`, borderRadius: 999, background: PINK, boxShadow: `4px 4px 0 ${INK}`, transform: `rotate(${tilt}deg)` }}>
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "0 14px" }}>
      {arrow("M4 12h15M13 6l6 6-6 6", -6)}
      {arrow("M20 12H5M11 6l-6 6 6 6", 6)}
      <div style={{ display: "flex", marginTop: 6, fontSize: 20, letterSpacing: 2, color: BLUE }}>ATOMIC SWAP</div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [facts, fonts] = await Promise.all([readDealFacts(id), cardFonts()]);
  const filled = facts?.status === "filled";
  const give = facts?.giveItems ?? [];
  const want = facts?.wantItems ?? [];
  // Every picture the card draws, read once: the Clubs' art, the Club's avatar, the MON mark.
  const paths = [...new Set([...give, ...want].map((i) => i.image).filter((p): p is string => !!p))];
  const [mon, avatar, ...art] = await Promise.all([publicImage("/brand/mon.svg"), publicImage(facts?.clubImage), ...paths.map((p) => publicImage(p))]);
  const images = new Map(paths.map((p, i) => [p, art[i]]));
  return new ImageResponse(
    (
      <CardFrame
        footer={
          facts?.club ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Avatar src={avatar} name={facts.club} size={46} />
              {facts.club} Club · Both sides or nothing.
            </div>
          ) : (
            "Both sides or nothing."
          )
        }
        badge={
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ display: "flex", fontSize: 40 }}>Deal #{id}</div>
            <Pill fill={filled ? GREEN : YELLOW}>{facts ? STATUS[facts.status] : "DEAL"}</Pill>
          </div>
        }
      >
        {facts ? (
          <div style={{ display: "flex", flex: 1, alignItems: "stretch", gap: 12, marginTop: 24, marginBottom: 18 }}>
            <Side label="I GIVE" items={give} images={images} mon={mon} />
            <Arrows />
            <Side
              label={facts.openOffer && filled ? "I GOT" : "I WANT"}
              items={want}
              images={images}
              mon={mon}
              words={facts.openOffer ? (filled ? "An accepted offer" : "Open to offers") : undefined}
            />
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, alignItems: "center", fontSize: 48 }}>Deal #{id}: a swap held in escrow on Monad.</div>
        )}
      </CardFrame>
    ),
    { ...size, fonts },
  );
}
