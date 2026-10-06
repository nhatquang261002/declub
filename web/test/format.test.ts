import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ago, countdown } from "../lib/format";

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

describe("countdown", () => {
  it("shows the two largest units that matter", () => {
    assert.equal(countdown(30), "<1m");
    assert.equal(countdown(41 * 60 + 5), "41m");
    assert.equal(countdown(22 * 3600 + 41 * 60), "22h 41m");
    assert.equal(countdown(2 * 86400 + 4 * 3600 + 59 * 60), "2d 4h");
  });
});
