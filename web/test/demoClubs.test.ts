import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listPosts } from "../lib/server/board";
import { clubDetail } from "../lib/server/clubs";
import { seedDemoClubs } from "../lib/server/demoClubs";
import { listMembers } from "../lib/server/members";
import { memoryStore } from "../lib/server/store";
import { registry } from "../lib/verifiedAssets";

describe("mock Clubs", () => {
  it("fill the first Club through the same reads the routes use", async () => {
    const store = memoryStore();
    const now = Date.now();
    await seedDemoClubs(store, now);
    const [busy] = registry.clubs();

    const detail = await clubDetail(store, busy, { settlements: async () => [], now: () => Math.floor(now / 1000) });
    assert.ok(detail.club.members >= 10);
    assert.ok(detail.club.stats.momentum >= 25, "busy enough to show off the heat scale");
    assert.ok(detail.recent.length > 0);

    const view = await listMembers(store, busy, [], "momentum", Math.floor(now / 1000), {
      holdings: async () => {
        throw new Error("a seeded balance should never be re-read");
      },
      now: () => now,
    });
    assert.equal(view.members.find((m) => m.role === "owner") !== undefined, true);

    const { posts } = await listPosts(store, busy, {});
    assert.ok(posts.length >= 5);
    assert.ok(posts[0].pinned, "the welcome post is pinned first");
  });
});
