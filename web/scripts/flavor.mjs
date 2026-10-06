#!/usr/bin/env node
// Runs a command as one of the app's flavors: `node scripts/flavor.mjs <testnet|mainnet> <command...>`
// (see flavorEnv.mjs and the README's "Flavors"). The npm scripts `dev:mainnet`, `build:mainnet` and
// the like are this with `next`.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flavorEnv } from "./flavorEnv.mjs";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [flavor, ...command] = process.argv.slice(2);
if (!flavor || command.length === 0) {
  console.error("usage: node scripts/flavor.mjs <testnet|mainnet> <command...>");
  process.exit(2);
}

const { env, problems, warnings, spec } = flavorEnv(flavor, { root: path.resolve(web, ".."), web });
for (const w of warnings) console.warn(`[${flavor}] warning: ${w}`);
if (problems.length > 0) {
  for (const p of problems) console.error(`[${flavor}] ${p}`);
  process.exit(1);
}
console.log(`[${flavor}] chain ${spec.chainId}, build folder ${spec.distDir}`);

const child = spawn(command[0], command.slice(1), { cwd: web, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
