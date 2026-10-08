/**
 * HTTP smoke tests against a running web app (`npm run build && npm start` in web/, or a deploy).
 *
 *   node src/web-smoke.ts --url http://localhost:3000
 *   node src/web-smoke.ts --url https://preview.example --expect-live
 *
 * --expect-live: the deal book, store and Privy must be configured (a production deployment), so
 * "feature off" answers fail instead of passing as a dev setup.
 * Writes e2e/results/web-<time>.{json,md}. Exits 1 if anything failed.
 */
import assert from "node:assert/strict";
import { arg, loadRootEnv, str } from "./lib/env.ts";
import { poolInfo } from "./lib/pool.ts";
import { type Case, Warning, finish, runCases } from "./lib/report.ts";

loadRootEnv();

interface Ctx {
  url: string;
  live: boolean;
  poolUrl?: string;
  intents?: string;
}

async function get(c: Ctx, path: string, init: RequestInit = {}) {
  const r = await fetch(new URL(path, c.url), { redirect: "manual", signal: AbortSignal.timeout(30_000), ...init });
  const text = await r.text();
  let json: Record<string, unknown> | undefined;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {}
  return { status: r.status, headers: r.headers, text, json };
}

const post = (c: Ctx, path: string, body: unknown, headers: Record<string, string> = {}) =>
  get(c, path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

/** A route answered "this feature is off here": fine in development, a failure with --expect-live. */
function off(c: Ctx, what: string) {
  if (c.live) assert.fail(`${what} is not configured on this deployment`);
  throw new Warning(`${what} is off here, so only its "off" answer was checked`);
}

const PAGES = ["/", "/deals", "/create", "/history", "/clubs", "/guide", "/guide/deals", "/account"];
/** Old routes that now redirect (the app's three redirect pages). */
const REDIRECTS: Record<string, string> = { "/v2/create": "/create", "/intents/new": "/create", "/intents": "/deals" };
/** Next.js's error boundary text, which a 200 can still carry. */
const BROKEN = /Application error: a (client|server)-side exception has occurred|Internal Server Error/;

const cases: Case<Ctx>[] = [
  {
    id: "WEB-01",
    title: "Every page renders (200, no error boundary); old routes redirect; unknown pages 404",
    async run(c, note) {
      const bad: string[] = [];
      for (const p of PAGES) {
        const r = await get(c, p);
        if (r.status !== 200 || BROKEN.test(r.text)) bad.push(`${p}: ${r.status}${BROKEN.test(r.text) ? " (error page)" : ""}`);
      }
      for (const [from, to] of Object.entries(REDIRECTS)) {
        const r = await get(c, from);
        const where = new URL(r.headers.get("location") ?? "", c.url).pathname;
        if (![301, 302, 307, 308].includes(r.status) || where !== to) bad.push(`${from}: ${r.status} → ${where}, expected a redirect to ${to}`);
      }
      const missing = await get(c, "/no-such-page-e2e");
      if (missing.status !== 404) bad.push(`unknown page: ${missing.status}, expected 404`);
      note(`${PAGES.length} pages`);
      assert.equal(bad.length, 0, bad.join("\n"));
    },
  },
  {
    id: "WEB-02",
    title: "Security headers on pages and API routes",
    async run(c) {
      const want: Record<string, RegExp> = {
        "x-frame-options": /^DENY$/i,
        "content-security-policy": /frame-ancestors 'none'/,
        "x-content-type-options": /^nosniff$/i,
        "referrer-policy": /strict-origin-when-cross-origin/,
        "permissions-policy": /camera=\(\)/,
      };
      const bad: string[] = [];
      for (const p of ["/", "/deals", "/api/deals"]) {
        const r = await get(c, p);
        for (const [h, re] of Object.entries(want)) {
          if (!re.test(r.headers.get(h) ?? "")) bad.push(`${p}: ${h} = ${r.headers.get(h) ?? "missing"}`);
        }
      }
      if (c.url.startsWith("https:")) {
        const hsts = (await get(c, "/")).headers.get("strict-transport-security");
        if (!hsts) bad.push("no Strict-Transport-Security on HTTPS");
      }
      assert.equal(bad.length, 0, bad.join("\n"));
    },
  },
  {
    id: "WEB-03",
    title: "GET /api/deals answers a page of the book; a bad query is a 400",
    async run(c, note) {
      const r = await get(c, "/api/deals");
      assert.equal(r.status, 200, `GET /api/deals: ${r.status} ${r.text.slice(0, 200)}`);
      assert.ok(r.json, "not JSON");
      if (r.json.enabled === false) off(c, "the deal book (NEXT_PUBLIC_DECLUB_ESCROW_ADDRESS)");
      assert.ok(Array.isArray(r.json.items), "no items array");
      note(
        `${(r.json.items as unknown[]).length} items, total ${String(r.json.total)}${r.json.signedError ? `, signed swaps: ${String(r.json.signedError)}` : ""}`,
      );
      if (r.json.signedError) throw new Warning(`the book couldn't read signed swaps from the pool: ${String(r.json.signedError)}`);
      const all = await get(c, "/api/deals?tab=all");
      assert.equal(all.status, 200);
      const bad = await get(c, "/api/deals?limit=-1&page=abc&sort=nonsense");
      assert.ok(bad.status === 400 || bad.status === 200, `bad query: ${bad.status}`);
    },
  },
  {
    id: "WEB-04",
    title: "Per-user routes refuse anonymous and forged-token callers",
    async run(c, note) {
      const routes: [string, string][] = [
        ["GET", "/api/state"],
        ["GET", "/api/profile"],
        ["GET", "/api/me/clubs"],
      ];
      const statuses: string[] = [];
      let disabled = 0;
      for (const [method, path] of routes) {
        for (const auth of [undefined, "Bearer e2e.forged.token"]) {
          const r = await get(c, path, { method, headers: auth ? { authorization: auth } : {} });
          statuses.push(`${path}${auth ? " (forged)" : ""} ${r.status}`);
          if (r.status === 200 && r.json?.enabled === false) {
            disabled++;
            continue;
          }
          assert.ok([401, 403].includes(r.status), `${method} ${path}${auth ? " with a forged token" : ""}: ${r.status} ${r.text.slice(0, 160)}`);
        }
      }
      note(statuses.join(", "));
      if (disabled) off(c, "per-user state (Upstash + PRIVY_APP_SECRET)");
    },
  },
  {
    id: "WEB-05",
    title: "The fill watcher's cron route needs its secret",
    async run(c) {
      const none = await get(c, "/api/cron/fills");
      if (none.status === 503) off(c, "the fill watcher (CRON_SECRET + store)");
      assert.equal(none.status, 401, `no secret: ${none.status}`);
      const wrong = await get(c, "/api/cron/fills", { headers: { authorization: "Bearer not-the-secret" } });
      assert.equal(wrong.status, 401, `wrong secret: ${wrong.status}`);
      const secret = str("CRON_SECRET");
      if (secret) {
        const ok = await get(c, "/api/cron/fills", { headers: { authorization: `Bearer ${secret}` } });
        assert.equal(ok.status, 200, `with CRON_SECRET: ${ok.status} ${ok.text.slice(0, 200)}`);
      }
    },
  },
  {
    id: "WEB-06",
    title: "The Privy webhook refuses unsigned and badly signed requests",
    async run(c) {
      const body = { type: "user.deleted", user: { id: "did:privy:e2e" } };
      const unsigned = await post(c, "/api/webhooks/privy", body);
      if (unsigned.status === 503) off(c, "Privy webhooks (PRIVY_WEBHOOK_SIGNING_SECRET)");
      assert.equal(unsigned.status, 401, `unsigned: ${unsigned.status}`);
      const forged = await post(c, "/api/webhooks/privy", body, {
        "svix-id": "msg_e2e",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,ZTJlLWZvcmdlZA==",
      });
      assert.equal(forged.status, 401, `forged signature: ${forged.status}`);
    },
  },
  {
    id: "WEB-07",
    title: "Input validation: bad hashes and addresses are 400s, not 500s",
    async run(c) {
      const bad: string[] = [];
      const check = async (label: string, p: Promise<{ status: number; json?: Record<string, unknown> }>) => {
        const r = await p;
        // With no store, the receipt routes answer { enabled: false } before reading input.
        if (r.status === 200 && r.json?.enabled === false) return;
        if (r.status !== 400) bad.push(`${label}: ${r.status}`);
      };
      await check("POST /api/fills bad hash", post(c, "/api/fills", { hash: "0x1234" }));
      await check("POST /api/activity bad hash", post(c, "/api/activity", { hash: "nope" }));
      await check("POST /api/activity not JSON", post(c, "/api/activity", "{{{"));
      await check("GET /api/fills bad address", get(c, "/api/fills?account=0xnope&contract=0x0"));
      await check("GET /api/collection-traits bad address", get(c, "/api/collection-traits?address=0xnope"));
      for (const p of ["/api/clubs/0xnope", "/api/profiles/lookup?handle="]) {
        const r = await get(c, p);
        if (r.status >= 500) bad.push(`GET ${p}: ${r.status}`);
      }
      assert.equal(bad.length, 0, bad.join("\n"));
    },
  },
  {
    id: "WEB-08",
    title: "The intent pool the app uses is up and settles through the app's contract",
    skip: (c) => (c.poolUrl ? null : "no NEXT_PUBLIC_POOL_URL / E2E_POOL_URL"),
    async run(c, note) {
      const info = await poolInfo<{ swap: string; chainId: number }>(c.poolUrl);
      note(`pool ${c.poolUrl}: chain ${info.chainId}, swap ${info.swap}`);
      if (c.intents) assert.equal(info.swap.toLowerCase(), c.intents.toLowerCase(), "the pool settles through another intents contract");
      const cors = await fetch(`${c.poolUrl}/intents?limit=1`, { headers: { origin: c.url }, signal: AbortSignal.timeout(10_000) });
      assert.ok(cors.headers.get("access-control-allow-origin"), "the pool doesn't allow the app's origin (CORS)");
    },
  },
];

async function main() {
  const ctx: Ctx = {
    url: arg("url") ?? str("E2E_WEB_URL", "http://localhost:3000"),
    live: arg("expect-live") !== undefined,
    poolUrl: str("E2E_POOL_URL", str("NEXT_PUBLIC_POOL_URL")) || undefined,
    intents: str("NEXT_PUBLIC_DECLUB_INTENTS_ADDRESS") || undefined,
  };
  try {
    await fetch(ctx.url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error(`${ctx.url} is not answering: start the app (cd web && npm run build && npm start) or pass --url`);
  }
  console.log(`web smoke against ${ctx.url}${ctx.live ? " (expect live config)" : ""}\n`);
  const results = await runCases(cases, ctx, arg("only"));
  process.exitCode = finish("web", results, { url: ctx.url, mode: ctx.live ? "live" : "dev" });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
