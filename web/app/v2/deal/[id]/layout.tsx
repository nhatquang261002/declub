import type { Metadata } from "next";
import type { ReactNode } from "react";
import { dealTitle } from "@/lib/dealShare";
import { readDealFacts } from "@/lib/server/dealCard";

/**
 * The deal page is a client screen that reads the chain in the browser, so what a link to it looks
 * like when shared (the title here, the card in opengraph-image.tsx) is read on the server.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const facts = await readDealFacts(id);
  if (!facts) return {};
  // The root layout's title template adds the site name.
  const title = `Deal #${id}: ${dealTitle(facts)}`;
  const description =
    facts.status === "open" ? "A swap held in escrow on Monad: both sides or nothing. Open it to take the deal." : "A swap held in escrow on Monad.";
  const image = `/v2/deal/${id}/opengraph-image`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: image, width: 1200, height: 630, alt: "Deal preview on DeClub" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function DealLayout({ children }: { children: ReactNode }) {
  return children;
}
