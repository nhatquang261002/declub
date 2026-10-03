import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientId } from "../lib/server/store";

const req = (headers: Record<string, string>) => new Request("http://x/api", { headers });
const SPOOFED = { "x-forwarded-for": "1.1.1.1, 203.0.113.5, 198.51.100.7" };

describe("clientId", () => {
  it("ignores every forwarding header when no proxy is trusted", () => {
    assert.equal(clientId(req({ ...SPOOFED, "x-real-ip": "9.9.9.9" }), {}), "unknown");
    assert.equal(clientId(req(SPOOFED), { TRUST_PROXY: "false" }), "unknown");
  });

  it("on Vercel, takes the platform's headers, never the client's x-forwarded-for", () => {
    const env = { VERCEL: "1" };
    assert.equal(clientId(req({ ...SPOOFED, "x-vercel-forwarded-for": "198.51.100.7" }), env), "198.51.100.7");
    assert.equal(clientId(req({ ...SPOOFED, "x-real-ip": "198.51.100.8" }), env), "198.51.100.8");
    assert.equal(clientId(req(SPOOFED), env), "unknown");
  });

  it("behind a trusted proxy, takes the entry it appended, counting from the right", () => {
    assert.equal(clientId(req(SPOOFED), { TRUST_PROXY: "true" }), "198.51.100.7");
    assert.equal(clientId(req(SPOOFED), { TRUST_PROXY: "1" }), "198.51.100.7");
    assert.equal(clientId(req(SPOOFED), { TRUST_PROXY: "2" }), "203.0.113.5");
    assert.equal(clientId(req({ "x-forwarded-for": "198.51.100.7" }), { TRUST_PROXY: "3" }), "unknown", "fewer entries than proxies");
    assert.equal(clientId(req({}), { TRUST_PROXY: "1" }), "unknown");
  });
});
