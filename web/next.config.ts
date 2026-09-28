import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Addresses and RPC live in the repo-root .env, shared with the Foundry scripts.
// Next only reads web/.env* on its own, so load the root one too (web/.env* still wins).
const repoRoot = path.resolve(__dirname, "..");
loadEnvConfig(repoRoot);

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
};

export default nextConfig;
