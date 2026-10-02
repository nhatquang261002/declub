import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ago } from "../lib/format";

describe("ago", () => {
  const NOW = 1_800_000_000;
  it("says how long ago, at the coarsest useful unit", () => {
    assert.equal(ago(NOW - 5, NOW), "just now");
    assert.equal(ago(NOW - 90, NOW), "1m ago");
    assert.equal(ago(NOW - 3 * 3600, NOW), "3h ago");
    assert.equal(ago(NOW - 2 * 86_400 - 5, NOW), "2d ago");
  });
  it("treats a time in the future as just now", () => {
    assert.equal(ago(NOW + 600, NOW), "just now");
  });
});
