import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_MODERATORS, applyRole, isOwnerOrAdmin, isStaff, mayActOn, roleOf, withoutUser, type ClubRole, type Roles } from "../lib/clubRoles";

const roles: Roles = { owner: "own", moderators: ["mod1", "mod2"] };

describe("roleOf", () => {
  it("is admin first, then owner, moderator, member", () => {
    assert.equal(roleOf(roles, "own", false), "owner");
    assert.equal(roleOf(roles, "mod1", false), "moderator");
    assert.equal(roleOf(roles, "someone", false), "member");
    assert.equal(roleOf(roles, "own", true), "admin", "an admin outranks a Club role");
    assert.equal(roleOf({ moderators: [] }, "x", true), "admin");
  });
});

describe("the permission matrix", () => {
  const all: ClubRole[] = ["admin", "owner", "moderator", "member"];
  // rows: actor, columns: target
  const allowed: Record<ClubRole, ClubRole[]> = {
    admin: ["admin", "owner", "moderator", "member"],
    owner: ["moderator", "member"],
    moderator: ["member"],
    member: [],
  };
  for (const actor of all) {
    for (const target of all) {
      it(`${actor} ${allowed[actor].includes(target) ? "may" : "may not"} act on ${target}`, () => {
        assert.equal(mayActOn(actor, target), allowed[actor].includes(target));
      });
    }
  }

  it("knows who is staff and who owns the Club's settings", () => {
    assert.deepEqual(all.filter(isStaff), ["admin", "owner", "moderator"]);
    assert.deepEqual(all.filter(isOwnerOrAdmin), ["admin", "owner"]);
  });
});

describe("applyRole", () => {
  it("lets the Owner appoint and remove Moderators", () => {
    const appointed = applyRole(roles, "owner", { userId: "new", role: "moderator" });
    assert.ok(appointed.ok);
    assert.deepEqual(appointed.roles, { owner: "own", moderators: ["mod1", "mod2", "new"] });
    assert.equal(appointed.action, "appoint_moderator");
    const removed = applyRole(roles, "owner", { userId: "mod1", role: null });
    assert.ok(removed.ok);
    assert.deepEqual(removed.roles.moderators, ["mod2"]);
    assert.equal(removed.action, "remove_moderator");
  });

  it("refuses a Moderator or a member, and an admin as the target", () => {
    for (const actor of ["moderator", "member"] as const) {
      assert.deepEqual(applyRole(roles, actor, { userId: "x", role: "moderator" }), { ok: false, reason: "forbidden" });
    }
    assert.deepEqual(applyRole(roles, "owner", { userId: "x", role: "moderator" }, true), { ok: false, reason: "forbidden" });
  });

  it("caps Moderators, and says when nothing changes", () => {
    const full: Roles = { owner: "own", moderators: Array.from({ length: MAX_MODERATORS }, (_, i) => `m${i}`) };
    assert.deepEqual(applyRole(full, "owner", { userId: "x", role: "moderator" }), { ok: false, reason: "too_many_moderators" });
    assert.deepEqual(applyRole(roles, "owner", { userId: "mod1", role: "moderator" }), { ok: false, reason: "no_change" });
    assert.deepEqual(applyRole(roles, "owner", { userId: "nobody", role: null }), { ok: false, reason: "no_change" });
  });

  it("never makes the Owner a Moderator", () => {
    assert.deepEqual(applyRole(roles, "admin", { userId: "own", role: "moderator" }), { ok: false, reason: "forbidden" });
  });

  it("hands ownership over: the old Owner becomes a plain member, the new one stops being a Moderator", () => {
    const r = applyRole(roles, "owner", { userId: "mod1", role: "owner" });
    assert.ok(r.ok);
    assert.deepEqual(r.roles, { owner: "mod1", moderators: ["mod2"] });
    assert.equal(r.action, "assign_owner");
    assert.deepEqual(applyRole(roles, "owner", { userId: "own", role: "owner" }), { ok: false, reason: "already_owner" });
  });

  it("lets only an admin remove the Owner", () => {
    assert.deepEqual(applyRole(roles, "owner", { userId: "own", role: null }), { ok: false, reason: "forbidden" });
    const r = applyRole(roles, "admin", { userId: "own", role: null });
    assert.ok(r.ok);
    assert.deepEqual(r.roles, { moderators: ["mod1", "mod2"] });
    assert.equal(r.action, "remove_owner");
  });

  it("lets an admin assign an Owner to a Club that has none", () => {
    const r = applyRole({ moderators: [] }, "admin", { userId: "u", role: "owner" });
    assert.ok(r.ok);
    assert.deepEqual(r.roles, { owner: "u", moderators: [] });
  });
});

describe("withoutUser", () => {
  it("strips whichever role the user held and leaves the rest", () => {
    assert.deepEqual(withoutUser(roles, "mod1"), { owner: "own", moderators: ["mod2"] });
    assert.deepEqual(withoutUser(roles, "own"), { moderators: ["mod1", "mod2"] });
    assert.deepEqual(withoutUser(roles, "nobody"), roles);
  });
});
