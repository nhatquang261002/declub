"use client";

import { CHOG_SWAP_V2_ADDRESS } from "@/lib/config";

/** "v1" = ChogSwap (Chogs + MON, trait requests). "v2" = ChogSwapV2 (any ERC-721 / ERC-20 / MON). */
export type TradeVersion = "v1" | "v2";

const OPTIONS: Array<[TradeVersion, string]> = [
  ["v1", "Chogs"],
  ["v2", "Multi-asset"],
];

/** Renders nothing until V2 is configured, so v1-only deployments look unchanged. */
export function VersionSwitch({
  value,
  onChange,
}: {
  value: TradeVersion;
  onChange: (version: TradeVersion) => void;
}) {
  if (!CHOG_SWAP_V2_ADDRESS) return null;
  return (
    <div className="flex gap-1 rounded-xl border border-line bg-panel p-1 text-sm" role="group" aria-label="Contract version">
      {OPTIONS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`rounded-lg px-3 py-1.5 font-medium ${
            value === key ? "bg-panel-2 text-white" : "text-muted hover:text-white"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
