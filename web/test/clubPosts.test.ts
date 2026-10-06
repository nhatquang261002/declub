import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_DESCRIPTION, POST_MAX, checkProfileEdit, cleanText, parseLink, pinnedFirst, viewPost, type StoredPost } from "../lib/clubPosts";

describe("cleanText", () => {
  it("trims, collapses spaces and turns line breaks and control characters into spaces", () => {
    assert.deepEqual(cleanText("  WTB   a Chog\n\nwith a crown\t! "), { ok: true, text: "WTB a Chog with a crown !" });
  });

  it("removes characters that can make one text read as another", () => {
    const bidi = "pay ‮evil‬ now​!﻿";
    const r = cleanText(bidi);
    assert.ok(r.ok);
    assert.ok(!/[‪-‮​﻿]/.test(r.text));
  });

  it("refuses empty and non-text input", () => {
    for (const bad of ["", "   \n\t ", "​​", undefined, null, 5, {}]) assert.deepEqual(cleanText(bad), { ok: false, reason: "empty" });
  });

  it("allows exactly the limit, counted in characters, and refuses one more", () => {
    assert.ok(cleanText("a".repeat(POST_MAX)).ok);
    assert.deepEqual(cleanText("a".repeat(POST_MAX + 1)), { ok: false, reason: "too_long" });
    assert.ok(cleanText("🐸".repeat(POST_MAX)).ok, "an emoji is one character, not two");
    assert.deepEqual(cleanText("🐸".repeat(POST_MAX + 1)), { ok: false, reason: "too_long" });
  });

  it("leaves markup as it is: it is shown as plain text, never interpreted", () => {
    assert.deepEqual(cleanText("<b>hi</b> [x](http://y)"), { ok: true, text: "<b>hi</b> [x](http://y)" });
  });
});

describe("parseLink", () => {
  const hash = "0x" + "AB".repeat(32);
  it("takes a deal id or an intent hash", () => {
    assert.deepEqual(parseLink(" 0042 "), { kind: "deal", id: "42" });
    assert.deepEqual(parseLink(hash), { kind: "intent", hash: hash.toLowerCase() });
  });
  it("refuses everything else", () => {
    for (const bad of ["", "abc", "-1", "1.5", "0x12", "0x" + "z".repeat(64), "1".repeat(19), "https://x.y", 7, null, undefined]) {
      assert.equal(parseLink(bad), null, String(bad));
    }
  });
});

describe("viewPost", () => {
  const post: StoredPost = { id: "p", userId: "author", wallet: "0xa", kind: "looking", text: "secret", link: { kind: "deal", id: "1" }, at: 1 };
  const hidden: StoredPost = { ...post, hidden: "reports" };

  it("shows a visible post to everyone and never the author's user id", () => {
    const v = viewPost(post, { staff: false }, false);
    assert.equal(v.text, "secret");
    assert.deepEqual(v.link, { kind: "deal", id: "1" });
    assert.ok(!JSON.stringify(v).includes("author"));
  });

  it("redacts a hidden post for others, but not for its author or staff", () => {
    const other = viewPost(hidden, { userId: "someone", staff: false }, false);
    assert.equal(other.text, null);
    assert.equal(other.link, undefined);
    assert.equal(other.hidden, "reports");
    assert.equal(viewPost(hidden, { userId: "author", staff: false }, false).text, "secret");
    assert.equal(viewPost(hidden, { userId: "mod", staff: true }, false).text, "secret");
  });

  it("marks mine and pinned, and gives the report count to staff only", () => {
    assert.equal(viewPost(post, { userId: "author", staff: false }, true).mine, true);
    assert.equal(viewPost(post, { userId: "author", staff: false }, true).pinned, true);
    assert.equal(viewPost(hidden, { userId: "mod", staff: true }, false, 3).reports, 3);
    assert.equal("reports" in viewPost(hidden, { userId: "author", staff: false }, false, 3), false);
  });
});

describe("pinnedFirst", () => {
  it("puts pinned posts on top in pin order and keeps the rest's order", () => {
    const posts = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    assert.deepEqual(pinnedFirst(posts, ["c", "a"]).map((p) => p.id), ["c", "a", "b", "d"]);
    assert.deepEqual(pinnedFirst(posts, ["gone"]).map((p) => p.id), ["a", "b", "c", "d"]);
  });
});

describe("checkProfileEdit", () => {
  it("accepts the editable fields, trimmed", () => {
    const r = checkProfileEdit({ description: "  Hello \n world ", links: ["https://example.com/a"], holdersOnlyPosts: true });
    assert.deepEqual(r, { ok: true, edit: { description: "Hello world", links: ["https://example.com/a"], holdersOnlyPosts: true } });
  });

  it("limits the description and the number of links", () => {
    assert.ok(checkProfileEdit({ description: "x".repeat(MAX_DESCRIPTION) }).ok);
    assert.equal(checkProfileEdit({ description: "x".repeat(MAX_DESCRIPTION + 1) }).ok, false);
    assert.ok(checkProfileEdit({ links: ["https://a.io", "https://b.io", "https://c.io"] }).ok);
    assert.equal(checkProfileEdit({ links: ["https://a.io", "https://b.io", "https://c.io", "https://d.io"] }).ok, false);
  });

  it("allows only plain https links", () => {
    for (const bad of ["http://a.io", "javascript:alert(1)", "data:text/html,x", "//a.io", "a.io", "https://user:pw@a.io", "ftp://a.io", `https://a.io/${"x".repeat(200)}`, 5]) {
      assert.equal(checkProfileEdit({ links: [bad] }).ok, false, String(bad));
    }
  });

  it("takes the coin rule, with or without a minimum", () => {
    assert.deepEqual(checkProfileEdit({ coinHolders: { on: true, min: "1000" } }), { ok: true, edit: { coinHolders: { on: true, min: "1000" } } });
    assert.deepEqual(checkProfileEdit({ coinHolders: { on: false } }), { ok: true, edit: { coinHolders: { on: false } } });
  });

  it("rejects wrong types and empty edits", () => {
    for (const bad of [
      null, "x", {}, { holdersOnlyPosts: "yes" }, { description: 5 }, { links: "https://a.io" },
      { coinHolders: true }, { coinHolders: { min: "5" } }, { coinHolders: { on: true, min: "0" } }, { coinHolders: { on: true, min: "1.5" } }, { coinHolders: { on: true, min: 5 } },
    ]) {
      assert.equal(checkProfileEdit(bad).ok, false, JSON.stringify(bad));
    }
  });
});
