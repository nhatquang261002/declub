import type { Metadata } from "next";
import type { ReactNode } from "react";
import { readClubFacts } from "@/lib/server/clubCard";

/**
 * The Club page is a client screen, so what a link to it looks like when shared (the title here, the
 * card in opengraph-image.tsx) is read on the server.
 */
export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const facts = await readClubFacts(address);
  if (!facts) return {};
  // The root layout's title template adds the site name; shared cards say it in full.
  const title = `${facts.name} Club`;
  const shareTitle = `${title} on DeClub`;
  const description = `Own ${facts.symbol}, post about it, get paid: swap fees go back to the Club's Holders every epoch.`;
  const image = `/clubs/${address}/opengraph-image`;
  return {
    title,
    description,
    openGraph: {
      title: shareTitle,
      description,
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: `${facts.name} Club preview on DeClub` }],
    },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: [image] },
  };
}

export default function ClubLayout({ children }: { children: ReactNode }) {
  return children;
}
