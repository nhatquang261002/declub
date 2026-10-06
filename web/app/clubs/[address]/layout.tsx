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
  const title = `${facts.name} Club on De(al) Club`;
  const description = `Own ${facts.symbol}, post about it, get paid: swap fees go back to the Club's Holders every epoch.`;
  return { title, description, openGraph: { title, description, type: "website" }, twitter: { card: "summary_large_image", title, description } };
}

export default function ClubLayout({ children }: { children: ReactNode }) {
  return children;
}
