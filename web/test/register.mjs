// Lets `node --test` run the app's TypeScript as it is: Node strips the types itself, and this
// hook adds what the bundler normally does, extensionless imports and the `@/` alias.
import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function withExtension(url) {
  const path = fileURLToPath(url);
  if (existsSync(path) && statSync(path).isFile()) return url;
  for (const extension of EXTENSIONS) {
    if (existsSync(path + extension)) return pathToFileURL(path + extension);
  }
  return null;
}

registerHooks({
  resolve(specifier, context, next) {
    let target = null;
    if (specifier.startsWith("@/")) target = new URL(specifier.slice(2), root);
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      target = new URL(specifier, context.parentURL);
    }
    const found = target && !/\.(json|m?js|cjs)$/.test(target.pathname) ? withExtension(target) : null;
    return next(found ? found.href : specifier, context);
  },
});

// The deal contract is optional in the app (lib/config.ts); tests run against the testnet one. Only
// tests get this stand-in: the loader also runs the scripts (`rewards:epoch`, `demo.ts`), and a preset
// value would win over the address in .env, which Next's env loading never overrides.
const testing = !!process.env.NODE_TEST_CONTEXT || process.execArgv.includes("--test") || process.argv.slice(1).some((arg) => /\.test\.[cm]?[jt]s$/.test(arg));
if (testing) process.env.NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS ||= "0x73591F76d7deE66F683A979cEffb4356982EE1bB";
