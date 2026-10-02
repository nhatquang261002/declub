"use client";

import Link from "next/link";
import { useState } from "react";
import { LoadError } from "@/components/ErrorPanel";
import { EmptyState } from "@/components/Page";
import { PostItem } from "@/components/PostItem";
import { Tabs } from "@/components/Tabs";
import { useClubActions, useClubPosts } from "@/hooks/useClubBoard";
import { useClubMembership } from "@/hooks/useClubMembership";
import { useSignIn } from "@/hooks/useSignIn";
import { POST_MAX, type PostKind } from "@/lib/clubPosts";

const KINDS = [
  { value: "note", label: "Note" },
  { value: "looking", label: "Looking for" },
] as const;

function Composer({ token }: { token: string }) {
  const { post } = useClubActions(token);
  const [kind, setKind] = useState<PostKind>("note");
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const length = [...text].length;

  return (
    <form
      className="page-section mb-4 flex flex-col gap-3 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        post.mutate(
          { kind, text, ...(kind === "looking" && link.trim() ? { link: link.trim() } : {}) },
          { onSuccess: () => (setText(""), setLink("")) },
        );
      }}
    >
      <Tabs value={kind} options={KINDS} onChange={setKind} label="Kind of post" />
      <label className="sr-only" htmlFor="club-post-text">
        Your post
      </label>
      <textarea
        id="club-post-text"
        className="input min-h-24 resize-y"
        value={text}
        maxLength={POST_MAX * 2}
        placeholder={kind === "looking" ? "WTB any Chog with a crown, 2 MON over floor" : "Say something to the Club"}
        onChange={(event) => setText(event.target.value)}
      />
      {kind === "looking" && (
        <input
          className="input"
          value={link}
          placeholder="Deal id or signed-swap hash (optional)"
          aria-label="Deal id or signed-swap hash"
          onChange={(event) => setLink(event.target.value)}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={`text-xs ${length > POST_MAX ? "text-danger" : "text-muted"}`}>
          {length}/{POST_MAX} · plain text only; links in a post aren’t clickable
        </p>
        <button type="submit" className="btn-primary" disabled={post.isPending || length === 0 || length > POST_MAX}>
          {post.isPending ? "Posting…" : "Post"}
        </button>
      </div>
      <p className="text-xs text-muted">
        Posting needs a verified X or Discord profile shared on your <Link href="/account" className="underline">Account</Link> page.
        Be kind: moderators can hide and remove posts, and three reports hide one at once.
      </p>
    </form>
  );
}

/** The Club's board: member posts, newest first, pinned ones on top. */
export function ClubBoard({ token, archived, now }: { token: string; archived: boolean; now: number }) {
  const { enabled, posts, isLoading, error } = useClubPosts(token);
  const me = useClubMembership(token);
  const signIn = useSignIn();
  const { report, remove, hide, pin, ban } = useClubActions(token);

  if (error && posts.length === 0) return <LoadError title="Couldn’t load the board" error={error} />;
  if (!enabled) return <EmptyState>This server isn’t keeping Club boards.</EmptyState>;

  return (
    <>
      {archived ? (
        <p className="mb-4 text-sm text-muted">This Club is archived, so the board is frozen.</p>
      ) : me.member ? (
        <Composer token={token} />
      ) : (
        <p className="mb-4 text-sm text-muted">
          {signIn ? (
            <>
              <button type="button" className="underline" onClick={signIn}>
                Sign in
              </button>{" "}
              and join the Club to post.
            </>
          ) : me.signedIn ? (
            "Join the Club to post."
          ) : (
            "Posting needs sign-in."
          )}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-muted">Loading the board…</p>
      ) : posts.length === 0 ? (
        <EmptyState>No posts yet.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {posts.map((post) => (
            <PostItem
              key={post.id}
              post={post}
              role={me.role}
              now={now}
              actions={{
                report: (id) => report.mutate(id),
                remove: (id) => remove.mutate(id),
                hide: (id, hidden) => hide.mutate({ id, hidden }),
                pin: (id, pinned) => pin.mutate({ id, pinned }),
                ban: (id) => ban.mutate({ post: id }),
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}
