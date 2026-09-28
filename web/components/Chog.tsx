"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useChogMetadata } from "@/hooks/useChogs";

/** Square Chog artwork from tokenURI, with a placeholder while it loads. */
export function ChogImage({ id, className = "" }: { id: bigint; className?: string }) {
  const { metadata } = useChogMetadata(id);
  const localArtwork: Record<string, string> = {
    "1159": "/art/chogs/chog-01.png",
    "1376": "/art/chogs/chog-02.png",
    "143": "/art/chogs/chog-03.png",
    "67": "/art/chogs/chog-04.png",
    "909": "/art/chogs/chog-05.png",
  };
  const image = metadata?.image ?? localArtwork[id.toString()];

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

/** Small tile used inside trade summaries. */
export function ChogThumb({ id, large = false }: { id: bigint; large?: boolean }) {
  return (
    <div className={`${large ? "w-20" : "w-14"} shrink-0 text-center`}>
      <ChogImage id={id} className={`rounded-lg border border-white/10 ${large ? "rotate-[-2deg]" : ""}`} />
      <div className="mt-1 font-mono text-[11px] text-muted">#{id.toString()}</div>
    </div>
  );
}

type ChogCardProps = {
  id: bigint;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children?: ReactNode;
};

/** Full card with traits. Clickable when `onClick` is given (pickers). */
export function ChogCard({ id, selected, disabled, onClick, children }: ChogCardProps) {
  const { metadata } = useChogMetadata(id);
  const traits = metadata?.attributes.filter((a) => a.value !== "None") ?? [];

  const body = (
    <>
      <ChogImage id={id} />
      <div className="p-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold">#{id.toString()}</span>
          {selected && <span className="text-xs font-semibold text-accent">Selected</span>}
        </div>
        <div className="mt-1.5 flex min-h-5 flex-wrap gap-1">
          {traits.map((t) => (
            <span
              key={t.trait_type}
              title={t.trait_type}
              className="rounded-md bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted"
            >
              {t.value}
            </span>
          ))}
        </div>
        {children}
      </div>
    </>
  );

  const frame = `card overflow-hidden text-left transition ${
    selected ? "border-accent ring-2 ring-accent/40" : ""
  }`;

  if (!onClick) return <div className={frame}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`${frame} hover:border-accent disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {body}
    </button>
  );
}

type ChogPickerProps = {
  ids: readonly bigint[];
  selected: readonly bigint[];
  onToggle: (id: bigint) => void;
  max: number;
  isLoading?: boolean;
  empty: ReactNode;
};

export function ChogPicker({ ids, selected, onToggle, max, isLoading, empty }: ChogPickerProps) {
  if (isLoading) return <p className="text-sm text-muted">Loading Chogs…</p>;
  if (ids.length === 0) return <div className="text-sm text-muted">{empty}</div>;

  const full = selected.length >= max;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
      {ids.map((id) => {
        const isSelected = selected.includes(id);
        return (
          <ChogCard
            key={id.toString()}
            id={id}
            selected={isSelected}
            disabled={!isSelected && full}
            onClick={() => onToggle(id)}
          />
        );
      })}
    </div>
  );
}
