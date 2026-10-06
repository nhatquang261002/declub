import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Addresses and RPC live in the repo-root .env, shared with the Foundry scripts.
// Next only reads web/.env* on its own, so load the root one too (web/.env* still wins).
//
// Next has already loaded (and cached) web/.env* by the time this file runs, so a plain
// loadEnvConfig(root) would return the cache and read nothing. Force each load: root first to
// collect its values, then web/ again so its values and real environment variables take priority.
const dev = process.env.NODE_ENV !== "production";
const root = loadEnvConfig(path.resolve(__dirname, ".."), dev, console, true).parsedEnv ?? {};
loadEnvConfig(__dirname, dev, console, true);
// Only the public values: the web server has no use for the matcher's key or the deploy settings.
for (const [key, value] of Object.entries(root)) {
  if (key.startsWith("NEXT_PUBLIC_")) process.env[key] ??= value;
}

/**
 * Sent with every response. The app may not be framed by anyone (clickjacking a signing or deal
 * button), though it frames others itself: Privy's auth.privy.io iframe lives inside our pages, and
 * these headers on our responses don't affect it. Only `frame-ancestors` is set in the CSP: a
 * script policy would have to allow Privy, WalletConnect and the wallets' own scripts.
 * Permissions-Policy turns off only features the app never uses; WebAuthn (passkeys) and payment
 * stay available to Privy's frames.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  // Each flavor builds into its own folder (scripts/flavorEnv.mjs), so testnet and mainnet can run at once.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: { root: __dirname },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
