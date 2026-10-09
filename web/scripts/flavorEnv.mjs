import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";

/**
 * The app's flavors (testnet, mainnet): the same code with another network's settings. A flavor owns
 * its chain id, its build folder and its default ports, so both can be built and served side by side.
 */
const FLAVORS = {
  testnet: { chainId: 10143, webPort: 3000, matcherPort: 8787, distDir: ".next" },
  mainnet: { chainId: 143, webPort: 3001, matcherPort: 8788, distDir: ".next-mainnet" },
};

const read = (file) => (existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {});
const blank = (v) => !v || !v.trim();
const upstash = (e) => (e.UPSTASH_REDIS_REST_URL || e.KV_REST_API_URL || "").trim().replace(/\/+$/, "");

/**
 * The environment a command runs in for a flavor.
 *
 * - testnet keeps working as before (repo-root `.env`, `web/.env.local`) until a `.env.testnet` exists.
 * - mainnet never reads those files: every key they set and the flavor's files don't becomes blank, so a
 *   testnet RPC, key or database can't leak into a mainnet build. Next doesn't override a variable that
 *   is already set, even to "".
 *
 * Files, later wins: repo-root `.env.<flavor>`, then `web/.env.<flavor>.local` (server secrets). Real
 * environment variables (a host's settings) win over both. `problems` must stop the command;
 * `warnings` are for the person to read.
 */
export function flavorEnv(flavor, { root, web, base = process.env }) {
  const spec = FLAVORS[flavor];
  if (!spec) throw new Error(`Unknown flavor "${flavor}" (use ${Object.keys(FLAVORS).join(" or ")})`);

  const files = [path.join(root, `.env.${flavor}`), path.join(web, `.env.${flavor}.local`)];
  const own = Object.assign({}, ...files.map(read));
  const problems = [];
  const warnings = [];
  const isolated = flavor !== "testnet" || files.some(existsSync);

  const env = { ...base };
  if (isolated) {
    if (!files.some(existsSync)) {
      problems.push(`${path.relative(root, files[0])} is missing. Copy ${path.relative(root, files[0])}.example and fill it in.`);
    }
    const shared = Object.assign({}, read(path.join(root, ".env")), read(path.join(web, ".env")), read(path.join(web, ".env.local")));
    for (const key of Object.keys(shared)) if (!(key in own) && !(key in base)) env[key] = "";
    for (const [key, value] of Object.entries(own)) env[key] ??= value;
  }

  if (blank(env.NEXT_PUBLIC_CHAIN_ID)) env.NEXT_PUBLIC_CHAIN_ID = String(spec.chainId);
  else if (Number(env.NEXT_PUBLIC_CHAIN_ID) !== spec.chainId) {
    problems.push(`NEXT_PUBLIC_CHAIN_ID is ${env.NEXT_PUBLIC_CHAIN_ID}, but the ${flavor} flavor is chain ${spec.chainId}.`);
  }
  env.APP_FLAVOR = flavor;
  env.NEXT_DIST_DIR = spec.distDir;
  if (blank(env.MATCHER_PORT)) env.MATCHER_PORT = String(spec.matcherPort);
  if (isolated) env.MATCHER_ENV_FILE = files[0];

  if (flavor === "mainnet") {
    if (!blank(env.NEXT_PUBLIC_MOCK_ERC20_ADDRESS)) problems.push("NEXT_PUBLIC_MOCK_ERC20_ADDRESS (a test token) must be unset on mainnet.");
    if (!blank(env.REWARDS_OPERATOR_KEY)) problems.push("REWARDS_OPERATOR_KEY must be unset on mainnet: epochs are published from the Safe.");
    if (env.NEXT_PUBLIC_CHOG_MINTABLE !== "false") problems.push("NEXT_PUBLIC_CHOG_MINTABLE must be false on mainnet.");
    for (const key of ["NEXT_PUBLIC_RPC_URL", "NEXT_PUBLIC_CHOG_ADDRESS"]) {
      if (blank(env[key])) problems.push(`${key} is required on mainnet.`);
    }
    if (/testnet/i.test(env.NEXT_PUBLIC_RPC_URL ?? "") || /testnet/i.test(env.MATCHER_RPC_URL ?? "")) {
      problems.push("An RPC URL looks like a testnet one.");
    }
    const testnetStore = upstash({ ...read(path.join(root, ".env")), ...read(path.join(web, ".env.local")) });
    if (testnetStore && upstash(env) === testnetStore) problems.push("Mainnet shares its Upstash database with the testnet one. Create a separate database.");
    if (blank(env.NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS))
      warnings.push("NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS is blank: the app will show no deals until the contracts are deployed.");
    if (blank(env.NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS)) warnings.push("NEXT_PUBLIC_DECLUB_REWARDS_ADDRESS is blank: Rewards can't be claimed.");
    if (blank(env.NEXT_PUBLIC_REWARDS_GENESIS)) warnings.push("NEXT_PUBLIC_REWARDS_GENESIS is blank: epochs would count from the testnet default, 2026-10-05.");
    if (blank(env.NEXT_PUBLIC_PRIVY_APP_ID)) warnings.push("NEXT_PUBLIC_PRIVY_APP_ID is blank: no social sign-in, so no Club posts.");
  }
  return { env, problems, warnings, spec };
}
