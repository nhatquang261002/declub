"use client";

import type { ReactNode } from "react";
import { SearchInput } from "@/components/SearchInput";
import { Select, type SelectOption } from "@/components/Select";
import { Tabs, type TabOption } from "@/components/Tabs";
import { DEFAULT_FILTERS, isFiltering, type MonFilter, type DealFilters, type DealSort } from "@/lib/dealFilters";
import type { DealTab } from "@/lib/dealBook";

const MON_OPTIONS: Array<SelectOption<MonFilter>> = [
  { value: "any", label: "Any MON" },
  { value: "offers-mon", label: "Offers MON" },
  { value: "wants-mon", label: "Wants MON" },
  { value: "no-mon", label: "No MON" },
];
const SORT_OPTIONS: Array<SelectOption<DealSort>> = [
  { value: "newest", label: "Newest first" },
  { value: "ending-soon", label: "Ending soon" },
];

/** Open · For you · All, with live counts on the first two. */
export function DealTabs({ tab, onTab, openCount, forYouCount }: { tab: DealTab; onTab: (tab: DealTab) => void; openCount: number; forYouCount: number }) {
  const tabs: Array<TabOption<DealTab>> = [
    { value: "open", label: `Open (${openCount})` },
    { value: "for-you", label: `For you (${forYouCount})` },
    { value: "all", label: "All" },
  ];
  return <Tabs label="Show deals" value={tab} options={tabs} onChange={onTab} />;
}

/** Search box, MON filter, sort, and a Clear button while any of them is set. */
export function DealFilterBar({
  filters,
  onChange,
  placeholder,
  extra,
}: {
  filters: DealFilters;
  onChange: (patch: Partial<DealFilters>) => void;
  placeholder: string;
  /** More controls, placed before the Clear button. */
  extra?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <SearchInput
        className="w-full sm:w-auto sm:min-w-52 sm:flex-1"
        label="Search deals"
        placeholder={placeholder}
        value={filters.query}
        onChange={(query) => onChange({ query })}
      />
      <Select className="w-auto" aria-label="Filter by MON" value={filters.mon} options={MON_OPTIONS} onChange={(mon) => onChange({ mon })} />
      <Select className="w-auto" aria-label="Sort deals" value={filters.sort} options={SORT_OPTIONS} onChange={(sort) => onChange({ sort })} />
      {extra}
      {isFiltering(filters) && (
        <button type="button" className="btn-secondary" onClick={() => onChange(DEFAULT_FILTERS)}>
          Clear
        </button>
      )}
    </div>
  );
}
