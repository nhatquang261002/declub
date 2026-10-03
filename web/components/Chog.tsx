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
        <Image
          src={image}
          alt={metadata?.name ?? `Chog #${id}`}
          fill
          unoptimized
          sizes="200px"
          className="object-cover"
        />
      ) : (
        <div className="grid h-full place-items-center font-mono text-xs text-muted">#{id}</div>
      )}
    </div>
  );
}

/** Small tile used inside deal summaries. `xl` is the deal page's stage. */
export function ChogThumb({ id, large = false, xl = false }: { id: bigint; large?: boolean; xl?: boolean }) {
  return (
    <div className={`${xl ? "w-24 sm:w-28" : large ? "w-20" : "w-14"} group/chog shrink-0 text-center`}>
      <ChogImage
        id={id}
        className={`rounded-lg border-2 border-[#111318] shadow-[0.18rem_0.18rem_0_#111318] transition-transform duration-200 ${
          large || xl ? "rotate-[-2deg] group-hover/chog:rotate-0 group-hover/chog:scale-105" : ""
        }`}
      />
      <div className={`mt-1.5 font-mono font-semibold text-muted ${xl ? "text-xs" : "text-[11px]"}`}>#{id.toString()}</div>
    </div>
  );
}
