"use client";

import Image from "next/image";
import { useChogMetadata } from "@/hooks/useChogs";

/** Square Chog artwork from tokenURI, with a placeholder while it loads. */
export function ChogImage({ id, className = "", preferLocal = false }: { id: bigint; className?: string; preferLocal?: boolean }) {
  const { metadata } = useChogMetadata(id);
  const localArtwork: Record<string, string> = {
    "1159": "/art/chogs/chog-01.png",
    "1376": "/art/chogs/chog-02.png",
    "143": "/art/chogs/chog-03.png",
    "67": "/art/chogs/chog-04.png",
    "909": "/art/chogs/chog-05.png",
  };
  const image = preferLocal ? (localArtwork[id.toString()] ?? metadata?.image) : (metadata?.image ?? localArtwork[id.toString()]);

  return (
    <div className={`relative aspect-square overflow-hidden bg-panel-2 ${className}`}>
      {image ? (
        <Image src={image} alt={metadata?.name ?? `Chog #${id}`} fill unoptimized sizes="200px" className="object-cover" />
      ) : (
        <div className="grid h-full place-items-center font-mono text-xs text-muted">#{id}</div>
      )}
    </div>
  );
}
