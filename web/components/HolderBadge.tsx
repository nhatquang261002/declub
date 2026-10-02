import { Tooltip } from "@/components/Tooltip";

/**
 * "Holder": the member held the asset when the server last checked (within a day). A badge, not a
 * guarantee and not a permission, and the tooltip says so.
 */
export function HolderBadge({ symbol }: { symbol?: string }) {
  return (
    <Tooltip
      content={`Held ${symbol ?? "this asset"} when the Club last checked, at most a day ago. It isn’t a guarantee, and it doesn’t unlock anything.`}
      className="cursor-help"
    >
      <span className="rounded-full border border-mint/50 px-2 py-0.5 text-xs font-semibold text-mint">Holder</span>
    </Tooltip>
  );
}
