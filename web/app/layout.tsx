import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import { explorerAddress, ON_DEAL_ADDRESS } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Only the wordmark uses this face; the rest of the app stays Geist.
const brand = Bricolage_Grotesque({ variable: "--font-brand", subsets: ["latin"], weight: "800" });

// The favicon is app/icon.svg, picked up by Next automatically.
export const metadata: Metadata = {
  title: "On Deal",
  description: "Trustless peer-to-peer deals and escrow for digital assets on Monad.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${brand.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
          <footer className="border-t border-line/70 px-4 py-5 text-center text-xs text-muted">
            Monad testnet ·{" "}
            <a
              href={explorerAddress(ON_DEAL_ADDRESS)}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline hover:text-white"
            >
              On Deal contract
            </a>{" "}
            · no admin, assets only move in your transactions, any fee is flat and only charged when a deal completes
          </footer>
        </Providers>
      </body>
    </html>
  );
}
