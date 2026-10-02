"use client";

import { Tabs } from "@/components/Tabs";
import { ON_DEAL_V2_ADDRESS } from "@/lib/config";

/** "v1" = OnDeal (Chogs + MON, trait requests). "v2" = OnDealV2 (any ERC-721 / ERC-20 / MON). */
export type DealVersion = "v1" | "v2";

const OPTIONS: Array<[DealVersion, string]> = [
  ["v1", "Chogs"],
  ["v2", "Multi-asset"],
];

/** Renders nothing until V2 is configured, so v1-only deployments look unchanged. */
export function VersionSwitch({
  value,
  onChange,
}: {
  value: DealVersion;
  onChange: (version: DealVersion) => void;
}) {
  if (!ON_DEAL_V2_ADDRESS) return null;
  return (
    <Tabs
      label="Contract version"
      value={value}
      options={OPTIONS.map(([key, label]) => ({ value: key, label }))}
      onChange={onChange}
    />
  );
}
