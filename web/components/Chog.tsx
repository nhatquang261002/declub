"use client";

import Image from "next/image";
import type { ReactNode } from "react";
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

type ChogCardProps = {
  id: bigint;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  preferLocalArtwork?: boolean;
  children?: ReactNode;
};

/** Full card with traits. Clickable when `onClick` is given (pickers). */
export function ChogCard({ id, selected, disabled, onClick, preferLocalArtwork, children }: ChogCardProps) {
  const { metadata } = useChogMetadata(id);
  const traits = metadata?.attributes.filter((a) => a.value !== "None") ?? [];

  const body = (
    <>
      <ChogImage id={id} preferLocal={preferLocalArtwork} />
      <div className="chog-card-body">
        <div className="flex items-center justify-between">
          <span className="chog-card-id">#{id.toString()}</span>
          {selected && <span className="chog-card-status">Selected</span>}
        </div>
        <div className="chog-card-traits">
          {traits.map((t) => (
            <span
              key={`${t.trait_type}:${t.value}`}
              title={t.trait_type}
              className="chog-trait"
            >
              <span className="chog-trait-type">{t.trait_type}</span>
              {t.value}
            </span>
          ))}
        </div>
        {children}
      </div>
    </>
  );

  const frame = `chog-card ${selected ? "chog-card-selected" : ""}`;

  if (!onClick) return <div className={frame}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`${frame} disabled:cursor-not-allowed disabled:opacity-40`}
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
  preferLocalArtwork?: boolean;
};

export function ChogPicker({ ids, selected, onToggle, max, isLoading, empty, preferLocalArtwork }: ChogPickerProps) {
  if (isLoading) return <p className="text-sm text-muted">Loading Chogs…</p>;
  if (ids.length === 0) return <div className="text-sm text-muted">{empty}</div>;

  const full = selected.length >= max;
  return (
    <div className="grid grid-cols-3 gap-3 p-1 sm:grid-cols-4 sm:gap-4 lg:grid-cols-5">
      {ids.map((id) => {
        const isSelected = selected.includes(id);
        return (
          <ChogCard
            key={id.toString()}
            id={id}
            selected={isSelected}
            disabled={!isSelected && full}
            onClick={() => onToggle(id)}
            preferLocalArtwork={preferLocalArtwork}
          />
        );
      })}
    </div>
  );
}
