import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import { explorerAddress, DECLUB_ESCROW_ADDRESS, SITE_URL } from "@/lib/config";
import { SUPPORT_EMAIL, SUPPORT_MAILTO, X_HANDLE, X_URL } from "@/lib/contact";
import { NETWORK } from "@/lib/network";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Only the wordmark uses this face; the rest of the app stays Geist.
const brand = Bricolage_Grotesque({ variable: "--font-brand", subsets: ["latin"], weight: "800" });

// The favicon is app/icon.svg, picked up by Next automatically.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "De(al) Club", template: "%s · De(al) Club" },
  description: "Clubs for Monad's NFT collections, where Holders share in the fees their Club's market makes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${brand.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
          <footer className="border-t border-line/70 px-4 py-5 text-center text-xs text-muted">
            {NETWORK.name} ·{" "}
            {DECLUB_ESCROW_ADDRESS && (
              <>
                <a href={explorerAddress(DECLUB_ESCROW_ADDRESS)} target="_blank" rel="noreferrer" className="font-mono underline hover:text-white">
                  DeClub escrow contract
                </a>{" "}
                ·{" "}
              </>
            )}
            assets only move in transactions or signatures you approve, and the fee is a small amount per NFT, capped and only charged when a deal completes
            <div className="mt-2">
              <a href={SUPPORT_MAILTO} className="underline hover:text-white">
                {SUPPORT_EMAIL}
              </a>{" "}
              ·{" "}
              <a href={X_URL} target="_blank" rel="noreferrer" className="underline hover:text-white">
                @{X_HANDLE} on X
              </a>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
