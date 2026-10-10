import { SearchIcon } from "./Icons";

/** The one search box: a magnifier in the sticker style of the dropdowns it sits beside. */
export function SearchInput({
  value,
  onChange,
  label,
  id,
  placeholder,
  maxLength,
  autoFocus,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  /** What it searches, for screen readers; leave it out when a visible `<label htmlFor={id}>` names it. */
  label?: string;
  id?: string;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  /** Width and flex rules for the box in its row. */
  className?: string;
}) {
  return (
    <div className={`relative ${className}`.trim()}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#4e5968]" />
      <input
        id={id}
        type="search"
        className="search-input"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
