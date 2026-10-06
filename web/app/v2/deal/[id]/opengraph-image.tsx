import { ImageResponse } from "next/og";
import { readDealFacts } from "@/lib/server/dealCard";
import type { DealFacts } from "@/lib/dealShare";

export const alt = "A deal on De(al) Club";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// A deal's status changes (open, filled), and the chain is read per request.
export const dynamic = "force-dynamic";

const INK = "#111318";
const YELLOW = "#f0b735";
const CREAM = "#fff8e6";

const STATUS: Record<DealFacts["status"], string> = { open: "OPEN", filled: "SWAPPED", cancelled: "CANCELLED", expired: "EXPIRED" };

/** Long lists shrink so they stay inside the card. */
const fit = (text: string) => (text.length > 60 ? 30 : text.length > 36 ? 38 : text.length > 14 ? 46 : 56);

/** What the right-hand card says: the ask, or for an open offer, that it takes offers (or took one). */
const wanted = (f: DealFacts) => (!f.openOffer ? f.want : f.status === "filled" ? "An accepted offer" : "Open to offers");

function Side({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden", border: `6px solid ${INK}`, borderRadius: 28, background: "white", padding: 36, boxShadow: `10px 10px 0 ${INK}` }}>
      <div style={{ display: "flex", fontSize: 28, fontWeight: 800, letterSpacing: 4 }}>{label}</div>
      <div style={{ display: "flex", marginTop: 18, fontSize: fit(text), fontWeight: 800, lineHeight: 1.15 }}>{text}</div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const facts = await readDealFacts(id);
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: CREAM, color: INK, padding: 56, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>De(al) Club</div>
          <div style={{ display: "flex", border: `5px solid ${INK}`, borderRadius: 999, background: facts?.status === "filled" ? "#7bd8a4" : YELLOW, padding: "8px 26px", fontSize: 30, fontWeight: 800 }}>
            {facts ? STATUS[facts.status] : "DEAL"}
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 84, fontWeight: 800 }}>Deal #{id}</div>
        {facts ? (
          <div style={{ display: "flex", flex: 1, alignItems: "stretch", gap: 40, marginTop: 24, marginBottom: 20 }}>
            <Side label="GIVES" text={facts.give} />
            <div style={{ display: "flex", alignItems: "center", fontSize: 40, fontWeight: 800 }}>FOR</div>
            <Side label={facts.openOffer && facts.status === "filled" ? "GOT" : "WANTS"} text={wanted(facts)} />
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, alignItems: "center", fontSize: 44, fontWeight: 800 }}>A swap held in escrow on Monad.</div>
        )}
        <div style={{ display: "flex", marginTop: 8, fontSize: 28, fontWeight: 700 }}>Both sides or nothing, on Monad.</div>
      </div>
    ),
    size,
  );
}
