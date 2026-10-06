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
  const title = `Deal #${id}: ${dealTitle(facts)}`;
  const description =
    facts.status === "open"
      ? "A swap held in escrow on Monad: both sides or nothing. Open it to take the deal."
      : "A swap held in escrow on Monad.";
  return { title, description, openGraph: { title, description, type: "website" }, twitter: { card: "summary_large_image", title, description } };
}

export default function DealLayout({ children }: { children: ReactNode }) {
  return children;
}
