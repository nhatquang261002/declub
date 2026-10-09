import { CheckIcon } from "@/components/Icons";
import { Tooltip } from "@/components/Tooltip";

/**
 * "Holder": the member held the asset when the server last checked (within a day). A badge, not a
 * guarantee and not a permission, and the tooltip says so.
 */
export function HolderBadge({ symbol }: { symbol?: string }) {
  return (
    <Tooltip
      content={`Held ${symbol ?? "this asset"} when the Club last checked, at most a day ago. It isn’t a guarantee. It can matter if the Owner limits posting to Holders.`}
      className="cursor-help"
    >
      <span className="chip chip-mint">
        <CheckIcon />
        Holder
      </span>
    </Tooltip>
  );
}
