"use client";

import {
  DEFAULT_FILTERS,
  isFiltering,
  type MonFilter,
  type TradeFilters,
  type TradeSort,
} from "@/lib/tradeFilters";

export type TradeTab = "open" | "for-you" | "all";

const MON_OPTIONS: Array<[MonFilter, string]> = [
  ["any", "Any MON"],
  ["offers-mon", "Offers MON"],
  ["wants-mon", "Wants MON"],
  ["no-mon", "No MON"],
];
const SORT_OPTIONS: Array<[TradeSort, string]> = [
  ["newest", "Newest first"],
  ["ending-soon", "Ending soon"],
];

/** Open · For you · All, with live counts on the first two. */
export function TradeTabs({
  tab,
  onTab,
  openCount,
  forYouCount,
}: {
  tab: TradeTab;
  onTab: (tab: TradeTab) => void;
  openCount: number;
  forYouCount: number;
}) {
  const tabs: Array<[TradeTab, string]> = [
    ["open", `Open (${openCount})`],
    ["for-you", `For you (${forYouCount})`],
    ["all", "All"],
  ];
  return (
    <div className="flex gap-1 rounded-xl border border-line bg-panel p-1 text-sm">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onTab(key)}
          className={`rounded-lg px-3 py-1.5 font-medium ${
            tab === key ? "bg-panel-2 text-white" : "text-muted hover:text-white"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Search box, MON filter, sort, and a Clear button while any of them is set. */
export function TradeFilterBar({
  filters,
  onChange,
  placeholder,
  suggestions,
}: {
  filters: TradeFilters;
  onChange: (patch: Partial<TradeFilters>) => void;
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
        aria-label="Search trades"
        list={suggestions ? "trade-suggestions" : undefined}
        value={filters.query}
        onChange={(e) => onChange({ query: e.target.value })}
      />
      {suggestions && (
        <datalist id="trade-suggestions">
          {suggestions.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
      )}
      <select
        className="input w-auto!"
        aria-label="Filter by MON"
        value={filters.mon}
        onChange={(e) => onChange({ mon: e.target.value as MonFilter })}
      >
        {MON_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <select
        className="input w-auto!"
        aria-label="Sort trades"
        value={filters.sort}
        onChange={(e) => onChange({ sort: e.target.value as TradeSort })}
      >
        {SORT_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      {isFiltering(filters) && (
        <button type="button" className="btn-secondary" onClick={() => onChange(DEFAULT_FILTERS)}>
          Clear
        </button>
      )}
    </div>
  );
}
