import { ImageResponse } from "next/og";
import { short } from "@/lib/recap";
import { readClubFacts } from "@/lib/server/clubCard";
import { CARD_SIZE, Avatar, cardFonts, CardFrame, publicImage, Pill } from "@/lib/server/cardKit";

export const alt = "A Club on DeClub";
export const size = CARD_SIZE;
export const contentType = "image/png";
// A Club's epochs close weekly, and the store is read per request.
export const dynamic = "force-dynamic";

/** A long Club name shrinks so it stays on the card. */
const fit = (text: string) => (text.length > 26 ? 52 : text.length > 16 ? 64 : 80);

/** The week's headline: what the Club paid its Holders, straight on the card. The MON mark and unit sit beside the amount. */
function Rewarded({ label, value, mon }: { label: string; value: string; mon: string | null }) {
  // "6.24 MON": the amount is the headline, its unit sits beside it.
  const [amount, unit] = [value.slice(0, value.lastIndexOf(" ")), value.slice(value.lastIndexOf(" ") + 1)];
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", fontSize: 30, letterSpacing: 4 }}>{label}</div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          {mon && <img src={mon} width={104} height={104} alt="" />}
          <div style={{ display: "flex", fontSize: 140, lineHeight: 1 }}>{amount}</div>
          <div style={{ display: "flex", alignSelf: "flex-end", marginBottom: 14, fontSize: 52 }}>{unit}</div>
        </div>
      </div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const [facts, fonts] = await Promise.all([readClubFacts(address), cardFonts()]);
  const [avatar, mon] = await Promise.all([publicImage(facts?.image), publicImage("/brand/mon.svg")]);
  const recap = facts?.recap ?? null;
  const paid = recap !== null && recap.paidHolders > 0n;
  return new ImageResponse(
    (
      <CardFrame
        footer="Hold it. Post about it. Get paid."
        badge={<Pill>{recap ? `WEEKLY RECAP · EPOCH ${recap.epoch}` : "CLUB"}</Pill>}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 20 }}>
          {facts && <Avatar src={avatar} name={facts.name} size={112} />}
          <div style={{ display: "flex", flex: 1, minWidth: 0, fontSize: fit(facts?.name ?? "Club"), lineHeight: 1.05 }}>
            {facts ? `${facts.name} Club` : "A Club on Monad"}
          </div>
        </div>
        {recap && paid ? (
          <div style={{ display: "flex", flex: 1, marginTop: 20, marginBottom: 26 }}>
            <Rewarded label={`REWARDED THIS WEEK TO ${recap.holderCount} ${recap.holderCount === 1 ? "HOLDER" : "HOLDERS"}`} value={short(recap.paidHolders)} mon={mon} />
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 12, marginBottom: 20 }}>
            <div style={{ display: "flex", fontSize: 54, lineHeight: 1.1 }}>
              {recap ? (recap.fees > 0n ? "Nothing to reward yet this week." : "A quiet week. Be first to swap.") : "Swap fees go back to the Club’s Holders every week."}
            </div>
          </div>
        )}
      </CardFrame>
    ),
    { ...size, fonts },
  );
}
