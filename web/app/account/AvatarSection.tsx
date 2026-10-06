"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useConnection } from "wagmi";
import type { Address } from "viem";
import { Alert } from "@/components/Alert";
import { NftPicker } from "@/components/NftPicker";
import { useToast } from "@/components/Toast";
import { useCollectionInfo } from "@/hooks/useCollection";
import { showOwnAvatar } from "@/hooks/useProfiles";
import { UPLOAD_SIZE, type AvatarView } from "@/lib/avatars";
import { collectionLabel } from "@/lib/collections";
import { shortAddress } from "@/lib/format";

type AvatarState = { enabled: false } | { enabled: true; avatar?: AvatarView; held?: boolean | null };
type Answer = AvatarState & { wallets?: string[]; message?: string };

const NO_TAKEN = new Set<string>();
/** Bigger files are refused before they are decoded: the result is a 256px square anyway. */
const MAX_FILE_BYTES = 20_000_000;

/** The signed-in user's avatar (ADR 0028), read and changed through `/api/avatar`. */
function useOwnAvatar() {
  const { getAccessToken, user } = usePrivy();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<AvatarState>();
  const [busy, setBusy] = useState(false);

  const call = useCallback(
    async (method: "GET" | "PUT" | "DELETE", body?: unknown): Promise<Answer> => {
      const token = await getAccessToken();
      const response = await fetch("/api/avatar", {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await response.json()) as Answer;
      if (!response.ok) throw new Error(data.message ?? "Couldn't update your avatar.");
      return data;
    },
    [getAccessToken],
  );

  // Linking or unlinking a wallet changes where the avatar shows, and the server catches up on read.
  const walletsKey = user?.linkedAccounts.map((a) => (a.type === "wallet" ? a.address : a.type)).join(",");
  useEffect(() => {
    let cancelled = false;
    call("GET")
      .then((next) => !cancelled && setState(next))
      // Avatars are optional: if the server can't say, the section stays hidden.
      .catch(() => !cancelled && setState({ enabled: false }));
    return () => {
      cancelled = true;
    };
  }, [call, walletsKey]);

  async function change(method: "PUT" | "DELETE", body?: unknown) {
    setBusy(true);
    try {
      const next = await call(method, body);
      setState(method === "DELETE" ? { enabled: true } : next);
      showOwnAvatar(queryClient, next.wallets ?? [], next.enabled ? (next.avatar ?? null) : null);
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  }

  return {
    state,
    busy,
    setBusy,
    pickNft: (collection: Address, tokenId: bigint) => change("PUT", { nft: { collection, tokenId: tokenId.toString() } }),
    upload: (dataUrl: string) => change("PUT", { upload: dataUrl }),
    remove: () => change("DELETE"),
  };
}

/** Crops the picture to a centred square and shrinks it to `UPLOAD_SIZE`, as WebP where the browser can. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const draw = (background?: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = UPLOAD_SIZE;
    const ctx = canvas.getContext("2d")!;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, UPLOAD_SIZE, UPLOAD_SIZE);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, UPLOAD_SIZE, UPLOAD_SIZE);
    return canvas;
  };
  try {
    const webp = draw().toDataURL("image/webp", 0.85);
    // Browsers that can't write WebP hand back a PNG; JPEG is smaller, but has no transparency.
    return webp.startsWith("data:image/webp") ? webp : draw("#ffffff").toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}

export function AvatarSection() {
  const { address: active } = useConnection();
  const { state, busy, setBusy, pickNft, upload, remove } = useOwnAvatar();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (!state?.enabled) return null;
  const { avatar, held } = state;

  async function onFile(chosen: File | undefined) {
    if (file.current) file.current.value = "";
    if (!chosen) return;
    if (chosen.size > MAX_FILE_BYTES) {
      toast.show({ tone: "warn", title: "That file is too big", message: "Pick an image under 20 MB." });
      return;
    }
    setBusy(true);
    let dataUrl: string;
    try {
      dataUrl = await shrink(chosen);
    } catch {
      setBusy(false);
      toast.show({ tone: "warn", title: "Couldn’t read that image", message: "Use a PNG, JPEG, WebP or GIF." });
      return;
    }
    await upload(dataUrl);
  }

  return (
    <section className="page-section px-5 py-5">
      <h2 className="text-lg font-semibold">Your avatar</h2>
      <p className="mt-1 text-sm text-muted">
        Shown on your wallet across DeClub: posts, Club members, rewards and the header. Pick an NFT you hold, or upload a
        picture. It shows beside every wallet linked to this sign-in, so others can tell those wallets are the same person.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <span
          className="avatar"
          style={{ width: "4.5rem", height: "4.5rem", background: "linear-gradient(135deg, #475066, #2b3446)" }}
          aria-hidden
        >
          {avatar && (
            // Arbitrary hosts from token metadata, so next/image's domain list doesn't apply.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar.image} alt="" referrerPolicy="no-referrer" className="avatar-img" />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="text-sm">
            {!avatar ? (
              <span className="text-muted">None yet: your wallet shows its own colours.</span>
            ) : avatar.nft ? (
              <NftLabel collection={avatar.nft.collection} tokenId={avatar.nft.tokenId} />
            ) : (
              "An uploaded picture"
            )}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              disabled={busy || !active}
              title={active ? undefined : "Connect a wallet to see its NFTs."}
              onClick={() => setPicking(true)}
            >
              Pick from my NFTs
            </button>
            <button className="btn-secondary" disabled={busy} onClick={() => file.current?.click()}>
              Upload an image
            </button>
            {avatar && (
              <button className="btn-secondary" disabled={busy} onClick={remove}>
                Remove
              </button>
            )}
            {busy && <span className="self-center text-xs text-muted">Saving…</span>}
          </div>
        </div>
      </div>

      {avatar?.nft && held === false && (
        <Alert tone="warn" title="You no longer hold this NFT" className="mt-4">
          Others see your wallet&apos;s colours instead until you pick another one, or it comes back to your wallet.
        </Alert>
      )}
      <p className="mt-3 text-xs text-muted">
        An NFT shows only while one of your linked wallets holds it. {active && `“Pick from my NFTs” lists what ${shortAddress(active)} holds.`}
      </p>

      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {picking && active && (
        <NftPicker
          owner={active}
          room={1}
          taken={NO_TAKEN}
          confirmLabel="Use as avatar"
          onClose={() => setPicking(false)}
          onConfirm={(collection, [id]) => {
            setPicking(false);
            if (id !== undefined) pickNft(collection, id);
          }}
        />
      )}
    </section>
  );
}

function NftLabel({ collection, tokenId }: { collection: Address; tokenId: string }) {
  const { info } = useCollectionInfo(collection);
  return (
    <>
      <span className="font-semibold">{collectionLabel(info, shortAddress(collection))}</span>{" "}
      <span className="font-mono text-muted">#{tokenId}</span>
    </>
  );
}
