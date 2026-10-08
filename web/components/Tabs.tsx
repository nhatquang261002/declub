"use client";

export type TabOption<T extends string> = { value: T; label: string };

/**
 * The one tab bar: a row of toggle buttons where exactly one is selected. Used for deal filters,
 * the history filters, the trait-request mode and the like. (Page numbers use the same `tabbar`/`tab` styles.)
 */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
  className = "",
}: {
  value: T;
  options: ReadonlyArray<TabOption<T>>;
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  className?: string;
}) {
  return (
    <div className={`tabbar ${className}`.trim()} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className="tab" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
