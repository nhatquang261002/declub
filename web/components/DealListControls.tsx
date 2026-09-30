"use client";

import { Select, type SelectOption } from "@/components/Select";
import { Tabs, type TabOption } from "@/components/Tabs";
import {
  DEFAULT_FILTERS,
  isFiltering,
  type MonFilter,
  type DealFilters,
  type DealSort,
} from "@/lib/dealFilters";

export type DealTab = "open" | "for-you" | "all";

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
export function DealTabs({
  tab,
  onTab,
  openCount,
  forYouCount,
}: {
  tab: DealTab;
  onTab: (tab: DealTab) => void;
  openCount: number;
  forYouCount: number;
}) {
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
  suggestions,
}: {
  filters: DealFilters;
  onChange: (patch: Partial<DealFilters>) => void;
  placeholder: string;
  /** Optional search suggestions (v1 offers trait labels). */
  suggestions?: string[];
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <input
        type="search"
        className="input min-w-52 flex-1"
        placeholder={placeholder}
        aria-label="Search deals"
        list={suggestions ? "deal-suggestions" : undefined}
        value={filters.query}
        onChange={(e) => onChange({ query: e.target.value })}
      />
      {suggestions && (
        <datalist id="deal-suggestions">
          {suggestions.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
      )}
      <Select
        className="w-auto"
        aria-label="Filter by MON"
        value={filters.mon}
        options={MON_OPTIONS}
        onChange={(mon) => onChange({ mon })}
      />
      <Select
        className="w-auto"
        aria-label="Sort deals"
        value={filters.sort}
        options={SORT_OPTIONS}
        onChange={(sort) => onChange({ sort })}
      />
      {isFiltering(filters) && (
        <button type="button" className="btn-secondary" onClick={() => onChange(DEFAULT_FILTERS)}>
          Clear
        </button>
      )}
    </div>
  );
}
