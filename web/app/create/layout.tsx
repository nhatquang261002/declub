import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page is a client component, so its title lives here. The root layout adds the site name.
export const metadata: Metadata = { title: "Create a deal" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
