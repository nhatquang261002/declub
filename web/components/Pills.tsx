"use client";

/**
 * A second-level switch inside a section: For trade / Wanted, a filter, a sort order. Same contract as
 * `Tabs`, drawn lighter so it doesn't read as another row of sections.
 */
export function Pills<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="pills" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className="pill" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
          {option.count !== undefined && <span className="pill-count">{option.count.toLocaleString()}</span>}
        </button>
      ))}
    </div>
  );
}
