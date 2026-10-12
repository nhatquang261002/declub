"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { EmojiPicker } from "@/components/EmojiPicker";
import { CrossIcon, ImageIcon, LinkIcon, XLogoIcon } from "@/components/Icons";
import { Spinner } from "@/components/Spinner";
import { WalletAvatar } from "@/components/WalletAvatar";
import { useToast } from "@/components/Toast";
import { useClubActions } from "@/hooks/useClubBoard";
import { MAX_PICTURE_FILE_BYTES, shrinkPostPicture, type PostPictureDraft } from "@/lib/browserImage";
import { POST_MAX, type PostKind } from "@/lib/clubPosts";

const KINDS: { value: PostKind; label: string; hint: string }[] = [
  {
    value: "note",
    label: "Note",
    hint: "Say something to the Club, or share an X post",
  },
  {
    value: "looking",
    label: "Looking for",
    hint: "What you want to buy or trade for",
  },
];

/** Characters left, as a ring that fills, turning amber near the limit and red past it. */
function CharRing({ length }: { length: number }) {
  const left = POST_MAX - length;
  const ring = left < 0 ? "#a9282f" : left <= 20 ? "#d99a12" : "#315ea8";
  return (
    <span className="flex items-center gap-1.5" aria-live="polite">
      <span
        className="char-ring"
        style={
          {
            "--p": Math.min(100, (length / POST_MAX) * 100),
            "--ring": ring,
          } as React.CSSProperties
        }
        aria-hidden
      />
      <span className={`text-xs tabular-nums ${left < 0 ? "font-bold text-danger" : "text-muted"}`}>
        {left <= 40 ? left : ""}
        <span className="sr-only">{left >= 0 ? `${left} characters left` : `${-left} characters over`}</span>
      </span>
    </span>
  );
}

/**
 * The box a member posts from: a note (with an optional X post) or a "Looking for" (with an
 * optional deal or signed swap), signed by their Club wallet. Used on a Club's Board and on the
 * timeline, which picks the Club first and passes the picker as `picker`, drawn on the row of kinds.
 * Re-mount it (a `key`) to change the Club.
 */
export function PostComposer({ token, wallet, xHint, picker }: { token: string; wallet?: string; xHint?: string; picker?: ReactNode }) {
  const textId = useId();
  const { post, postStage } = useClubActions(token);
  const toast = useToast();
  const [kind, setKind] = useState<PostKind>("note");
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [picture, setPicture] = useState<PostPictureDraft>();
  const [preparing, setPreparing] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const length = [...text].length;
  const area = useRef<HTMLTextAreaElement>(null);
  const hint = KINDS.find((k) => k.value === kind)!.hint;

  // The preview is an object URL; give it back when the picture goes or the box does.
  useEffect(() => () => (picture ? URL.revokeObjectURL(picture.previewUrl) : undefined), [picture]);

  async function onFile(chosen: File | undefined) {
    if (file.current) file.current.value = "";
    if (!chosen) return;
    if (!chosen.type.startsWith("image/") || chosen.size > MAX_PICTURE_FILE_BYTES) {
      toast.show({ tone: "warn", title: "That file won’t work", message: "Pick a picture under 25 MB." });
      return;
    }
    setPreparing(true);
    try {
      setPicture(await shrinkPostPicture(chosen));
    } catch (error) {
      toast.error(error);
    } finally {
      setPreparing(false);
    }
  }

  return (
    <form
      className="club-panel mb-5 p-4 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault();
        post.mutate(
          { kind, text, wallet, picture, ...(link.trim() ? { link: link.trim() } : {}) },
          { onSuccess: () => (setText(""), setLink(""), setPicture(undefined)) },
        );
      }}
    >
      <div className="flex gap-3">
        <span className="hidden sm:block">
          <WalletAvatar seed={wallet} size="2.5rem" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
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
            {picker}
          </div>
          <label className="sr-only" htmlFor={textId}>
            Your post
          </label>
          <textarea
            ref={area}
            id={textId}
            className="input min-h-24 resize-y border-2 border-[#111318]/25 bg-white text-[0.95rem] focus:border-[#111318]"
            value={text}
            maxLength={POST_MAX * 2}
            placeholder={kind === "looking" ? "WTB any Chog with a crown, 2 MON over floor" : hint}
            readOnly={post.isPending}
            onChange={(event) => setText(event.target.value)}
          />
          {picture && (
            <div className="picture-draft">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={picture.previewUrl} alt="The picture you are adding" />
              <button type="button" aria-label="Remove the picture" disabled={post.isPending} onClick={() => setPicture(undefined)}>
                <CrossIcon className="size-3.5" />
              </button>
            </div>
          )}
          {kind === "note" && (
            <div className="flex flex-col gap-1.5">
              <label className="relative">
                <span className="sr-only">An X post to share (optional)</span>
                <XLogoIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted" />
                <input
                  className="input border-2 border-[#111318]/25 bg-white pl-9 focus:border-[#111318]"
                  value={link}
                  readOnly={post.isPending}
                  inputMode="url"
                  placeholder="Share an X post: paste its link (optional)"
                  onChange={(event) => setLink(event.target.value)}
                />
              </label>
              {xHint && <p className="text-xs text-muted">Your own X post counts for the Club, if you hold its asset, when it {xHint}. One a day.</p>}
            </div>
          )}
          {kind === "looking" && (
            <label className="relative">
              <span className="sr-only">Deal id or signed-swap hash (optional)</span>
              <LinkIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input
                className="input border-2 border-[#111318]/25 bg-white pl-9 focus:border-[#111318]"
                value={link}
                readOnly={post.isPending}
                placeholder="Attach a deal id or signed-swap hash (optional)"
                onChange={(event) => setLink(event.target.value)}
              />
            </label>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted" role="status">
              {post.isPending
                ? postStage === "sending"
                  ? "Signed. Posting it to the Club…"
                  : "Waiting for you in your wallet. If nothing opened, check your wallet extension."
                : "Plain text, with emoji or one picture. Your Club wallet signs each post, so it’s yours to take anywhere."}
            </p>
            <div className="flex items-center gap-1">
              <EmojiPicker box={area} text={text} setText={setText} club={token} disabled={post.isPending} />
              <input ref={file} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(event) => void onFile(event.target.files?.[0])} />
              <button
                type="button"
                className="icon-btn"
                aria-label={picture ? "Change the picture" : "Add a picture"}
                aria-busy={preparing}
                disabled={post.isPending || preparing}
                onClick={() => file.current?.click()}
              >
                {preparing ? <Spinner /> : <ImageIcon className="size-5" />}
              </button>
              <span className="mx-2">
                <CharRing length={length} />
              </span>
              <button
                type="submit"
                className="btn-primary btn-sm px-5"
                aria-busy={post.isPending}
                disabled={post.isPending || preparing || text.trim().length === 0 || length > POST_MAX}
              >
                {post.isPending && <Spinner />}
                {post.isPending ? (postStage === "sending" ? "Posting…" : "Confirm in wallet…") : "Sign & post"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
