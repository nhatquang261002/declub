"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LoadError } from "@/components/ErrorPanel";
import { Pills } from "@/components/Pills";
import { LinkIcon, XLogoIcon } from "@/components/Icons";
import { JoinClubButton } from "@/components/JoinClubButton";
import { PostItem } from "@/components/PostItem";
import { WalletAvatar } from "@/components/WalletAvatar";
import { useClubActions, useClubPage, useClubPosts } from "@/hooks/useClubBoard";
import { useClubMembership } from "@/hooks/useClubMembership";
import { useFollows } from "@/hooks/useSocial";
import { POST_MAX, REPORTS_TO_HIDE, type PostKind } from "@/lib/clubPosts";
import { isStaff } from "@/lib/clubRoles";
import { LENSES, type LensId } from "@/lib/lenses";
import { Empty, Loading } from "./parts";

const KINDS: { value: PostKind; label: string; hint: string }[] = [
  { value: "note", label: "Note", hint: "Say something to the Club, or share an X post" },
  { value: "looking", label: "Looking for", hint: "What you want to buy or trade for" },
];

const FILTERS = [
  { value: "all", label: "All posts" },
  { value: "looking", label: "Looking for" },
] as const;

/** Characters left, as a ring that fills, turning amber near the limit and red past it. */
function CharRing({ length }: { length: number }) {
  const left = POST_MAX - length;
  const ring = left < 0 ? "#a9282f" : left <= 20 ? "#d99a12" : "#315ea8";
  return (
    <span className="flex items-center gap-1.5" aria-live="polite">
      <span className="char-ring" style={{ "--p": Math.min(100, (length / POST_MAX) * 100), "--ring": ring } as React.CSSProperties} aria-hidden />
      <span className={`text-xs tabular-nums ${left < 0 ? "font-bold text-danger" : "text-muted"}`}>
        {left <= 40 ? left : ""}
        <span className="sr-only">{left >= 0 ? `${left} characters left` : `${-left} characters over`}</span>
      </span>
    </span>
  );
}

function Composer({ token, wallet, xHint }: { token: string; wallet?: string; xHint?: string }) {
  const { post } = useClubActions(token);
  const [kind, setKind] = useState<PostKind>("note");
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const length = [...text].length;
  const hint = KINDS.find((k) => k.value === kind)!.hint;

  return (
    <form
      className="club-panel mb-5 p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        post.mutate(
          { kind, text, wallet, ...(link.trim() ? { link: link.trim() } : {}) },
          { onSuccess: () => (setText(""), setLink("")) },
        );
      }}
    >
      <div className="flex gap-3">
        <span className="hidden sm:block">
          <WalletAvatar seed={wallet} size="2.5rem" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex gap-1.5" role="group" aria-label="Kind of post">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                aria-pressed={kind === k.value}
                className={`chip px-3 py-1 text-xs ${kind === k.value ? "chip-peach" : "hover:bg-white"}`}
                onClick={() => (setKind(k.value), setLink(""))}
              >
                {k.label}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="club-post-text">
            Your post
          </label>
          <textarea
            id="club-post-text"
            className="input min-h-24 resize-y border-2 border-[#111318]/25 bg-white text-[0.95rem] focus:border-[#111318]"
            value={text}
            maxLength={POST_MAX * 2}
            placeholder={kind === "looking" ? "WTB any Chog with a crown, 2 MON over floor" : hint}
            onChange={(event) => setText(event.target.value)}
          />
          {kind === "note" && (
            <div className="flex flex-col gap-1.5">
              <label className="relative">
                <span className="sr-only">An X post to share (optional)</span>
                <XLogoIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
                <input
                  className="input border-2 border-[#111318]/25 bg-white pl-9 focus:border-[#111318]"
                  value={link}
                  inputMode="url"
                  placeholder="Share an X post: paste its link (optional)"
                  onChange={(event) => setLink(event.target.value)}
                />
              </label>
              {xHint && (
                <p className="text-xs text-muted">
                  Your own X post counts for the Club, if you hold its asset, when it {xHint}. One a day.
                </p>
              )}
            </div>
          )}
          {kind === "looking" && (
            <label className="relative">
              <span className="sr-only">Deal id or signed-swap hash (optional)</span>
              <LinkIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input
                className="input border-2 border-[#111318]/25 bg-white pl-9 focus:border-[#111318]"
                value={link}
                placeholder="Attach a deal id or signed-swap hash (optional)"
                onChange={(event) => setLink(event.target.value)}
              />
            </label>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">Plain text. Your Club wallet signs each post, so it’s yours to take anywhere.</p>
            <div className="flex items-center gap-3">
              <CharRing length={length} />
              <button type="submit" className="btn-primary btn-sm px-5" disabled={post.isPending || text.trim().length === 0 || length > POST_MAX}>
                {post.isPending ? "Signing…" : "Sign & post"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

/** Why the viewer can't post, and what would let them. */
function CantPost({ token, symbol, reason }: { token: string; symbol: string; reason: "join" | "holders" }) {
  return (
    <div className="club-panel mb-5 flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center">
      <div>
        <p className="font-extrabold">{reason === "join" ? "Join the conversation" : "Only holders post here"}</p>
        <p className="mt-0.5 text-sm text-muted">
          {reason === "join"
            ? `Members of this Club can post notes and what they’re looking for. Joining shows your wallet on the Members list.`
            : `This Club’s Owner has limited posting to members who hold ${symbol}. You can still read and report.`}
        </p>
      </div>
      {reason === "join" && <JoinClubButton token={token} symbol={symbol} archived={false} hint={false} />}
    </div>
  );
}

/** The Club's board: member posts, newest first, pinned ones on top. */
export function ClubBoard({ token, symbol, archived, now }: { token: string; symbol: string; archived: boolean; now: number }) {
  const follows = useFollows();
  const [lens, setLens] = useState<LensId>("newest");
  // Following needs to know who's reading; without a wallet it falls back to everything.
  const lenses = LENSES.filter((l) => l.id !== "following" || follows.me);
  const active = lenses.find((l) => l.id === lens) ?? lenses[0]!;
  const { enabled, posts, isLoading, error } = useClubPosts(token, active.id, follows.me);
  const me = useClubMembership(token);
  const page = useClubPage(token);
  const { report, remove, hide, pin, ban } = useClubActions(token);
  const [filter, setFilter] = useState<"all" | "looking">("all");
  const shown = useMemo(() => (filter === "all" ? posts : posts.filter((p) => p.kind === "looking")), [posts, filter]);

  if (error && posts.length === 0) return <LoadError title="Couldn’t load the board" error={error} />;
  if (!enabled) return <Empty title="No board on this server">This server isn’t keeping Club boards.</Empty>;

  const holdersOnly = page?.holdersOnlyPosts === true && me.member && !me.holder && !(me.role && isStaff(me.role));

  return (
    <>
      {archived ? (
        <p className="mb-5 text-sm text-muted">This Club is archived, so the board is frozen.</p>
      ) : me.member ? (
        holdersOnly ? (
          <CantPost token={token} symbol={symbol} reason="holders" />
        ) : (
          <Composer token={token} wallet={me.wallet} xHint={page?.x?.hint} />
        )
      ) : (
        <CantPost token={token} symbol={symbol} reason="join" />
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <Pills value={active.id} options={lenses.map((l) => ({ value: l.id, label: l.name }))} onChange={setLens} label="Order posts by" />
        <Pills value={filter} options={FILTERS} onChange={setFilter} label="Show posts" />
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">{active.description}</p>
        {me.member && !archived && (
          <p className="text-xs text-muted">
            Posting needs a verified X or Discord profile on your{" "}
            <Link href="/account" className="font-bold underline">
              Account
            </Link>
            .
          </p>
        )}
      </div>

      {isLoading ? (
        <Loading label="Loading the board" />
      ) : shown.length === 0 ? (
        <Empty title={active.id === "following" ? "Nobody you follow has posted here" : filter === "looking" ? "Nobody is looking for anything yet" : "No posts yet"}>
          {active.id === "following"
            ? "Follow members from their posts or the Members list to see them here."
            : me.member && !archived
              ? "Start it off: say hello, or post what you’re looking for."
              : "Posts from members will show up here."}
        </Empty>
      ) : (
        <ul className="club-panel overflow-hidden">
          {shown.map((post) => (
            <PostItem
              key={post.id}
              post={post}
              role={me.role}
              now={now}
              follows={follows}
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
      {!isLoading && posts.length > 0 && (
        <p className="mt-3 text-xs text-muted">Be kind: moderators can hide and remove posts, and {REPORTS_TO_HIDE} reports hide one at once.</p>
      )}
    </>
  );
}
