import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { makeReader, makeSender, readFee, readFeeSetup } from "./chain.ts";
import { loadConfig, loadRootEnv } from "./config.ts";
import { Matcher, defaultMatcherConfig } from "./matcher.ts";
import { Pool } from "./pool.ts";
import { RateLimiter } from "./ratelimit.ts";
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
// The fee token and recipient are fixed; the amount can change, so it is read when needed.
const feeSetup = await readFeeSetup(reader, cfg.swap);

const pool = new Pool(
  store,
  reader,
  {
    chainId: cfg.chainId,
    swap: cfg.swap,
    feeToken: feeSetup.token,
    minTtlSec: 60,
    maxTtlSec: 7 * 24 * 60 * 60,
    maxLivePerMaker: cfg.maxIntentsPerMaker,
    pruneBatch: cfg.pruneBatch,
    tokenAllowlist: cfg.tokenAllowlist,
  },
  {
    onNew: () => matcher.kick(),
    log,
    makerLimit: new RateLimiter({ perMinute: cfg.rateLimitMaker }),
  },
);
const matcher = new Matcher(
  pool,
  sender,
  {
    ...defaultMatcherConfig(cfg.swap),
    maxSearchSteps: cfg.maxSearchSteps,
    tokenBanMs: cfg.tokenBanMs,
    maxStrikes: cfg.maxStrikes,
  },
  log,
);

const server = createPoolServer(pool, {
  chainId: cfg.chainId,
  swap: cfg.swap,
  matcher: sender.account.address,
  fee: async () => ({
    token: feeSetup.token,
    amount: (await readFee(reader, cfg.swap)).toString(),
    recipient: feeSetup.recipient,
  }),
}, {
  ipLimit: new RateLimiter({ perMinute: cfg.rateLimitIp }),
  trustProxy: cfg.trustProxy,
});

server.listen(cfg.port, cfg.host, () => {
  log(`pool listening on http://${cfg.host}:${cfg.port}`);
  log(`settling on chain ${cfg.chainId} via ${cfg.swap} as ${sender.account.address}`);
  log(
    cfg.tokenAllowlist
      ? `matching only ${cfg.tokenAllowlist.size} allowlisted token(s) and the fee token`
      : "no token allowlist: any token is matched (set MATCHER_TOKEN_ALLOWLIST on a public deployment)",
  );
  void readFee(reader, cfg.swap).then((amount) =>
    log(`protocol fee: ${amount} of ${feeSetup.token} per maker, to ${feeSetup.recipient}`),
  );
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
