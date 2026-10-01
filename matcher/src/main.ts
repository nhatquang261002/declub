import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { makeReader, makeSender } from "./chain.ts";
import { loadConfig, loadRootEnv } from "./config.ts";
import { Matcher, defaultMatcherConfig } from "./matcher.ts";
import { Pool } from "./pool.ts";
import { createPoolServer } from "./server.ts";
import { Store } from "./store.ts";

loadRootEnv();
const cfg = loadConfig();
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (msg: string) => console.log(`${stamp()} ${msg}`);

mkdirSync(dirname(cfg.dbPath), { recursive: true });
const store = new Store(cfg.dbPath);
const reader = makeReader(cfg);
const sender = makeSender(cfg, cfg.privateKey);

const pool = new Pool(
  store,
  reader,
  {
    chainId: cfg.chainId,
    swap: cfg.swap,
    minTtlSec: 60,
    maxTtlSec: 7 * 24 * 60 * 60,
  },
  { onNew: () => matcher.kick(), log },
);
const matcher = new Matcher(pool, sender, defaultMatcherConfig(cfg.swap), log);

const server = createPoolServer(pool, {
  chainId: cfg.chainId,
  swap: cfg.swap,
  matcher: sender.account.address,
});

server.listen(cfg.port, cfg.host, () => {
  log(`pool listening on http://${cfg.host}:${cfg.port}`);
  log(`settling on chain ${cfg.chainId} via ${cfg.swap} as ${sender.account.address}`);
  matcher.start({ pollMs: cfg.pollMs, pruneMs: cfg.pruneMs });
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    matcher.stop();
    server.close();
    store.close();
    process.exit(0);
  });
}
