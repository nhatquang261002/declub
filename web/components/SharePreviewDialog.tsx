"use client";

import { useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { CheckIcon, CopyIcon, CrossIcon, XLogoIcon } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { useModalFocus } from "@/hooks/useModalFocus";

export function SharePreviewDialog({ imageUrl, shareUrl, title, onClose }: { imageUrl: string; shareUrl: string; title: string; onClose: () => void }) {
  const { panel, initial, onKeyDown } = useModalFocus(onClose);
  const [copied, setCopied] = useState(false);
  // The card is drawn on request (it reads the chain), so it takes a moment: say so, and say when it can't load.
  const [image, setImage] = useState<"loading" | "ready" | "failed">("loading");
  const toast = useToast();

  async function copyImage() {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("Your browser does not support copying images to the clipboard.");
      }
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`The preview image could not be loaded (${response.status}).`);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      setCopied(true);
      toast.show({ tone: "success", title: "Image copied." });
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error(error);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="page-section flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col gap-4 overflow-auto p-4 sm:p-5"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          <button ref={initial} type="button" className="icon-button" aria-label="Close share preview" onClick={onClose}>
            <CrossIcon />
          </button>
        </div>
        <div className="relative aspect-[1200/630] w-full overflow-hidden rounded-xl border-2 border-[#111318] bg-[#fff8e6]">
          {image !== "ready" && (
            <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted" role="status">
              {image === "loading" ? "Drawing the preview…" : "The preview couldn’t be drawn. You can still share the post: X will try again when it expands."}
            </div>
          )}
          <Image
            src={imageUrl}
            alt={`${title} preview`}
            width={1200}
            height={630}
            unoptimized
            className={`h-auto w-full ${image === "ready" ? "" : "invisible"}`}
            onLoad={() => setImage("ready")}
            onError={() => setImage("failed")}
          />
        </div>
        <p className="text-sm text-muted">This is the image people will see when the post expands on X.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={copyImage} disabled={image !== "ready"}>
            {copied ? <CheckIcon className="size-4 text-[#1f7a55]" /> : <CopyIcon className="size-4" />}
            {copied ? "Copied image" : "Copy image"}
          </button>
          {image === "ready" && (
            <a href={imageUrl} download="declub-share.png" className="btn-secondary inline-flex items-center gap-2">
              Save image
            </a>
          )}
          <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex items-center gap-2" onClick={onClose}>
            <XLogoIcon className="size-3.5" />
            Share on X
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}
