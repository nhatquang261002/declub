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

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
};

export default nextConfig;
