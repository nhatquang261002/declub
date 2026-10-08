import assert from "node:assert/strict";

/** What the intent pool (the matcher) says about itself at `GET /info`; fails the check if it doesn't answer 200. */
export async function poolInfo<T>(poolUrl: string | undefined): Promise<T> {
  assert.ok(poolUrl, "no pool URL");
  const r = await fetch(`${poolUrl}/info`, { signal: AbortSignal.timeout(10_000) });
  assert.equal(r.status, 200, `GET /info: ${r.status}`);
  return (await r.json()) as T;
}
