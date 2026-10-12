import type { Hex } from "viem";
import { POST_IMAGE_EDGE, POST_IMAGE_MAX_BYTES } from "./clubPosts";

/**
 * A picture ready to send (ADR 0056, 0057): shrunk in the browser so it fits the limits, with the
 * SHA-256 of its bytes, which a post's signature covers. `previewUrl` is an object URL; revoke it when done.
 */
export type PostPictureDraft = { dataUrl: string; hash: Hex; previewUrl: string; size: number };

/** Bigger files are refused before they are decoded. */
export const MAX_PICTURE_FILE_BYTES = 25_000_000;

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

const toHex = (bytes: ArrayBuffer): Hex => `0x${[...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * Scales a picture down to fit `edge` pixels on its longer side and writes it as WebP (JPEG on a
 * browser that can't), lowering the quality and then the size until it fits `maxBytes`. Drawing it
 * again drops its metadata (location, camera), and an animated picture becomes its first frame.
 */
export async function shrinkPicture(file: File, edge: number, maxBytes: number): Promise<PostPictureDraft> {
  const bitmap = await createImageBitmap(file);
  try {
    for (let size = edge; size >= edge / 4; size = Math.round(size * 0.75)) {
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.7, 0.55]) {
        let blob = await toBlob(canvas, "image/webp", quality);
        // A browser that can't write WebP hands back a PNG, which can be far larger; JPEG is smaller, but has no transparency.
        if (blob?.type !== "image/webp") {
          const flat = document.createElement("canvas");
          flat.width = canvas.width;
          flat.height = canvas.height;
          const ctx = flat.getContext("2d")!;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, flat.width, flat.height);
          ctx.drawImage(canvas, 0, 0);
          blob = await toBlob(flat, "image/jpeg", quality);
        }
        if (blob && blob.size <= maxBytes) {
          return {
            dataUrl: await readAsDataUrl(blob),
            hash: toHex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
            previewUrl: URL.createObjectURL(blob),
            size: blob.size,
          };
        }
      }
    }
    throw new Error("That picture is too big to shrink. Pick another one.");
  } finally {
    bitmap.close();
  }
}

/** A picture for a post: at most `POST_IMAGE_EDGE` pixels and `POST_IMAGE_MAX_BYTES`. */
export const shrinkPostPicture = (file: File) => shrinkPicture(file, POST_IMAGE_EDGE, POST_IMAGE_MAX_BYTES);
