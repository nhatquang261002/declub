"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type SelectOption<T extends string = string> = { value: T; label: string };

/**
 * The one dropdown: a sticker button that opens a cream listbox. Replaces native `<select>` so
 * the open menu matches the rest of the app. Keyboard: arrows, Home/End, Enter/Space, Escape and
 * type-ahead. An option with value "" is treated as the placeholder (shown muted).
 */
export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
  placeholder = "Select…",
  "aria-label": ariaLabel,
  className = "w-full",
}: {
  id?: string;
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  /** Sizes the wrapper; defaults to full width. Pass `w-auto` to fit the content. */
  className?: string;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];
  const isPlaceholder = value === "" || !selected;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function show() {
    setActive(Math.max(selectedIndex, 0));
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  }

  function move(to: number) {
    setActive(Math.min(Math.max(to, 0), options.length - 1));
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) return show();
        return move(active + (event.key === "ArrowDown" ? 1 : -1));
      }
      case "Home":
      case "End":
        if (!open) return;
        event.preventDefault();
        return move(event.key === "Home" ? 0 : options.length - 1);
      case "Enter":
      case " ":
        event.preventDefault();
        return open ? choose(active) : show();
      case "Escape":
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        return;
      case "Tab":
        return setOpen(false);
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
        const letter = event.key.toLowerCase();
        const from = open ? active + 1 : selectedIndex + 1;
        const order = [...options.keys()].map((i) => (from + i) % options.length);
        const hit = order.find((i) => options[i].label.toLowerCase().startsWith(letter));
        if (hit === undefined) return;
        if (open) setActive(hit);
        else onChange(options[hit].value);
      }
    }
  }

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        id={id}
        type="button"
        className="select-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${uid}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className={`truncate ${isPlaceholder ? "opacity-55" : ""}`}>{selected?.label ?? placeholder}</span>
        <svg
          className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m3.5 6 4.5 4.5L12.5 6" />
        </svg>
      </button>
      {open && (
        <ul ref={list} id={listId} role="listbox" aria-label={ariaLabel} className="select-menu">
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${uid}-${index}`}
              role="option"
              aria-selected={option.value === value}
              data-active={index === active}
              className="select-option"
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span className={option.value === "" ? "opacity-55" : undefined}>{option.label}</span>
              {option.value === value && option.value !== "" && (
                <svg
                  className="size-4 shrink-0"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="m3 8.5 3.2 3.2L13 4.5" />
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
