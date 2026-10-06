import path from "node:path";
import nextEnv from "@next/env";

// A CommonJS package: Node only gives ESM a default export for it.
const { loadEnvConfig } = nextEnv;

/**
 * Loads the root .env, then web/.env*, where web's values win. Call it before importing the app's
 * modules: lib/config.ts reads the env once, at import.
 *
 * Each `loadEnvConfig(…, forceReload)` starts again from the env the process began with, so a
 * second call drops what the first loaded; the root's values are carried over by hand.
 */
export function loadEnv(web: string): void {
  const quiet = { info: () => {}, error: console.error };
  loadEnvConfig(path.resolve(web, ".."), false, quiet, true);
  const root = { ...process.env };
  loadEnvConfig(web, false, quiet, true);
  for (const [key, value] of Object.entries(root)) process.env[key] ??= value;
}
