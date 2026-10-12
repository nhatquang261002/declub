"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CrossIcon, ImageIcon } from "@/components/Icons";
import { Spinner } from "@/components/Spinner";
import { useToast } from "@/components/Toast";
import { useClubActions, useClubPack } from "@/hooks/useClubBoard";
import { MAX_PICTURE_FILE_BYTES, shrinkPicture, type PostPictureDraft } from "@/lib/browserImage";
import { DEFAULT_STICKERS, PACK_EDGE, PACK_EMOJI_MAX, PACK_IMAGE_MAX_BYTES, PACK_NAME, PACK_STICKER_MAX, type PackItem, type PackKind } from "@/lib/clubPack";

const field = "input border-2 border-[#111318]/25 bg-white focus:border-[#111318]";
const MAX: Record<PackKind, number> = { emoji: PACK_EMOJI_MAX, sticker: PACK_STICKER_MAX };

/** One of the Club's emoji or stickers, with a button to take it away. */
function Tile({ item, onRemove }: { item: PackItem; onRemove?: () => void }) {
  return (
    <li className={`pack-tile ${item.kind === "sticker" ? "pack-tile-sticker" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.url} alt="" />
      <code>:{item.name}:</code>
      {onRemove && (
        <button type="button" aria-label={`Remove :${item.name}:`} onClick={onRemove}>
          <CrossIcon className="size-3" />
        </button>
      )}
    </li>
  );
}

/**
 * The Club's own emoji and stickers (ADR 0057), for its staff: what is there, and a form to add one
 * (or replace the one of that name). A picture is shrunk here to fit before it is sent, so staff can
 * pick any image.
 */
export function ClubPack({ token }: { token: string }) {
  const { items } = useClubPack(token);
  const { packAdd, packRemove } = useClubActions(token);
  const toast = useToast();
  const [kind, setKind] = useState<PackKind>("emoji");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<PostPictureDraft>();
  const [preparing, setPreparing] = useState(false);
  const [removing, setRemoving] = useState<PackItem>();
  const file = useRef<HTMLInputElement>(null);

  // The preview is an object URL; give it back when the picture goes or the form does.
  useEffect(() => () => (draft ? URL.revokeObjectURL(draft.previewUrl) : undefined), [draft]);

  async function onFile(chosen: File | undefined, forKind: PackKind) {
    if (file.current) file.current.value = "";
    if (!chosen) return;
    if (!chosen.type.startsWith("image/") || chosen.size > MAX_PICTURE_FILE_BYTES) {
      toast.show({ tone: "warn", title: "That file won’t work", message: "Pick a picture under 25 MB." });
      return;
    }
    setPreparing(true);
    try {
      setDraft(await shrinkPicture(chosen, PACK_EDGE[forKind], PACK_IMAGE_MAX_BYTES));
    } catch (error) {
      toast.error(error);
    } finally {
      setPreparing(false);
    }
  }

  const exists = items.find((item) => item.name === name);
  const builtin = DEFAULT_STICKERS.find((item) => item.name === name);
  const valid = PACK_NAME.test(name);
  const count = (k: PackKind) => items.filter((item) => item.kind === k).length;
  const full = !exists && count(kind) >= MAX[kind];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        Members use them in posts and replies by typing <code>:name:</code> or picking them from the smiley list. A post that is only one shows it large. Taking
        one away leaves <code>:name:</code> as plain text in older posts.
      </p>

      {(["emoji", "sticker"] as const).map((k) => (
        <div key={k}>
          <h3 className="mb-2 text-sm font-bold">
            {k === "emoji" ? "Emoji" : "Stickers"}{" "}
            <span className="font-normal text-muted tabular-nums">
              {count(k)}/{MAX[k]}
            </span>
          </h3>
          {count(k) === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            <ul
              className={`grid gap-2 ${k === "sticker" ? "grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]"}`}
            >
              {items
                .filter((item) => item.kind === k)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((item) => (
                  <Tile key={item.name} item={item} onRemove={() => setRemoving(item)} />
                ))}
            </ul>
          )}
        </div>
      ))}

      <div>
        <h3 className="mb-2 text-sm font-bold">
          Built in <span className="font-normal text-muted">every Club has these stickers</span>
        </h3>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
          {DEFAULT_STICKERS.map((item) => (
            <Tile key={item.name} item={item} />
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Add an emoji or sticker with the same name to replace one in this Club.</p>
      </div>

      <form
        className="flex flex-col gap-3 border-t border-[#111318]/10 pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft) return;
          packAdd.mutate({ name, kind, image: draft.dataUrl }, { onSuccess: () => (setName(""), setDraft(undefined)) });
        }}
      >
        <h3 className="text-sm font-bold">Add one</h3>
        <div className="flex gap-1.5" role="group" aria-label="Kind">
          {(["emoji", "sticker"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              className={`chip px-3 py-1 text-xs ${kind === k ? "chip-peach" : "hover:bg-white"}`}
              onClick={() => (setKind(k), setDraft(undefined))}
            >
              {k === "emoji" ? "Emoji" : "Sticker"}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold">Name</span>
          <input
            className={field}
            value={name}
            maxLength={24}
            placeholder="chog_wave"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
          />
          <span className="text-xs text-muted">
            {name && !valid
              ? "2 to 24 letters, digits or _, with at least one letter."
              : exists
                ? exists.kind === kind
                  ? `:${name}: already exists. Adding replaces its picture.`
                  : `:${name}: is already a ${exists.kind}. Pick another name.`
                : builtin
                  ? `:${name}: is a built-in sticker. Yours replaces it in this Club.`
                  : "Members type it between colons."}
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={file} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={(event) => void onFile(event.target.files?.[0], kind)} />
          <button
            type="button"
            className="btn-secondary btn-sm"
            aria-busy={preparing}
            disabled={preparing || packAdd.isPending}
            onClick={() => file.current?.click()}
          >
            {preparing ? <Spinner /> : <ImageIcon className="size-4" />}
            {draft ? "Change the picture" : "Pick a picture"}
          </button>
          {draft && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.previewUrl}
              alt="The picture you are adding"
              className={
                kind === "sticker" ? "h-20 w-auto rounded-lg border-2 border-[#111318] bg-white" : "h-10 w-auto rounded-lg border-2 border-[#111318] bg-white"
              }
            />
          )}
        </div>
        <p className="text-xs text-muted">
          {kind === "emoji" ? "Shown small, in the text." : "Shown large."} Any image works: it is shrunk to fit. A moving picture becomes its first frame.
        </p>
        <div>
          <button
            type="submit"
            className="btn-primary btn-sm px-5"
            aria-busy={packAdd.isPending}
            disabled={packAdd.isPending || preparing || !draft || !valid || full || (!!exists && exists.kind !== kind)}
          >
            {packAdd.isPending && <Spinner />}
            {exists?.kind === kind ? "Replace" : "Add"}
          </button>
          {full && (
            <span className="ml-3 text-xs text-danger">
              This Club has all {MAX[kind]} {kind === "emoji" ? "emoji" : "stickers"} it can hold.
            </span>
          )}
        </div>
      </form>

      {removing && (
        <ConfirmDialog
          title={`Remove :${removing.name}:?`}
          message="Members can’t use it any more, and older posts show :name: as plain text."
          confirmLabel="Remove"
          danger
          onCancel={() => setRemoving(undefined)}
          onConfirm={() => (packRemove.mutate(removing.name), setRemoving(undefined))}
        />
      )}
    </div>
  );
}
