import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import { explorerAddress, CHOG_SWAP_ADDRESS } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Chog Swap",
  description: "Trustless OTC trading and escrow for Chogs on Monad.",
  icons: {
    icon: "/brand/Badge_(Face_Chog)/FACE_CHOG.svg",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
          <footer className="border-t border-line/70 px-4 py-5 text-center text-xs text-muted">
            Monad testnet ·{" "}
            <a
              href={explorerAddress(CHOG_SWAP_ADDRESS)}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline hover:text-white"
            >
              ChogSwap contract
            </a>{" "}
            · no admin, no fees, assets only move in your transactions
          </footer>
        </Providers>
      </body>
    </html>
  );
}
