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

const args = process.argv.slice(2);
/** Whether `--name` was given. */
export const flag = (name: string) => args.includes(`--${name}`);
/** The value after `--name`, if it was given. */
export const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Stops a script that has nowhere to read or write the app's data. Call it after `loadEnv`. */
export function requireStore(): void {
  if (!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)) {
    throw new Error("No store: set the Upstash credentials the app uses (UPSTASH_REDIS_REST_URL / _TOKEN).");
  }
}
