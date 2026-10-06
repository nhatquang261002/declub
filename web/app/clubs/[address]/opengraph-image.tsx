import { ImageResponse } from "next/og";
import { formatMon } from "@/lib/format";
import { readClubFacts } from "@/lib/server/clubCard";

export const alt = "A Club on De(al) Club";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// A Club's epochs close weekly, and the store is read per request.
export const dynamic = "force-dynamic";

const INK = "#111318";
const YELLOW = "#f0b735";
const CREAM = "#fff8e6";
const GREEN = "#7bd8a4";

/** A long Club name shrinks so it stays on the card. */
const fit = (text: string) => (text.length > 26 ? 56 : text.length > 16 ? 72 : 96);

function Stat({ label, value, fill }: { label: string; value: string; fill: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, border: `6px solid ${INK}`, borderRadius: 28, background: fill, padding: 32, boxShadow: `10px 10px 0 ${INK}` }}>
      <div style={{ display: "flex", fontSize: 28, fontWeight: 800, letterSpacing: 4 }}>{label}</div>
      <div style={{ display: "flex", marginTop: 14, fontSize: 56, fontWeight: 800, lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const facts = await readClubFacts(address);
  const recap = facts?.recap ?? null;
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: CREAM, color: INK, padding: 56, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>De(al) Club</div>
          <div style={{ display: "flex", border: `5px solid ${INK}`, borderRadius: 999, background: YELLOW, padding: "8px 26px", fontSize: 30, fontWeight: 800 }}>
            {recap ? "WEEKLY RECAP" : "CLUB"}
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: fit(facts?.name ?? "Club"), fontWeight: 800, lineHeight: 1.05 }}>
          {facts ? `${facts.name} Club` : "A Club on Monad"}
        </div>
        {recap ? (
          <div style={{ display: "flex", flex: 1, alignItems: "stretch", gap: 40, marginTop: 28, marginBottom: 20 }}>
            <Stat label="SWAP FEES THIS WEEK" value={formatMon(recap.fees)} fill="white" />
            {recap.paidHolders > 0n && (
              <Stat label={`PAID TO ${recap.holderCount} ${recap.holderCount === 1 ? "HOLDER" : "HOLDERS"}`} value={formatMon(recap.paidHolders)} fill={GREEN} />
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, alignItems: "center", fontSize: 44, fontWeight: 800 }}>
            Swap fees go back to the Club’s Holders every epoch.
          </div>
        )}
        <div style={{ display: "flex", marginTop: 8, fontSize: 28, fontWeight: 700 }}>Own it, post about it, get paid.</div>
      </div>
    ),
    size,
  );
}
