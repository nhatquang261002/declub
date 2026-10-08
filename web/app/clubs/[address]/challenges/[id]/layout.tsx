import type { Metadata } from "next";
import type { ReactNode } from "react";
import { endsText, namesText } from "@/lib/challengeShare";
import { readChallengeFacts } from "@/lib/server/challengeCard";

/**
 * The challenge page is a client screen, so what a link to it looks like when shared (the title
 * here, the card in opengraph-image.tsx: the podium, or the prize and the time left) is read on the
 * server (ADR 0045).
 */
export async function generateMetadata({ params }: { params: Promise<{ address: string; id: string }> }): Promise<Metadata> {
  const { address, id } = await params;
  const facts = await readChallengeFacts(address, id);
  const c = facts?.challenge;
  if (!facts || !c) return {};
  // The root layout's title template adds the site name; shared cards say it in full.
  const title = `“${c.title}” · ${facts.club} Club challenge`;
  const shareTitle = `${title} on DeClub`;
  const won = c.phase === "settled" && c.winners.length > 0;
  const description = won
    ? `Won by ${namesText(c.winners.map((w) => w.name), c.winnerCount)}. ${c.brief}`
    : c.phase === "open"
      ? `${c.brief} Enter by ${endsText(c.endsAt)} with your own X post.`
      : c.brief;
  const image = `/clubs/${address}/challenges/${id}/opengraph-image`;
  return {
    title,
    description,
    openGraph: { title: shareTitle, description, type: "website", images: [{ url: image, width: 1200, height: 630, alt: `${c.title}: a ${facts.club} Club challenge on DeClub` }] },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: [image] },
  };
}

export default function ChallengeLayout({ children }: { children: ReactNode }) {
  return children;
}
