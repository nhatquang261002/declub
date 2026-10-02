"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { MoreIcon } from "./Icons";
import { usePopover } from "./Popover";

export type MenuAction = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Asked with window.confirm first: for what can't be undone. */
  confirm?: string;
  danger?: boolean;
};

/**
 * A "⋯" button that opens a short list of actions. Each group is split from the next by a rule, so
 * a member's own actions sit apart from the moderator's. Arrow keys move through the items and
 * Escape closes it, returning focus to the button.
 */
export function ActionMenu({ groups, label }: { groups: ReadonlyArray<ReadonlyArray<MenuAction>>; label: string }) {
  const { open, setOpen, ref } = usePopover();
  const button = useRef<HTMLButtonElement>(null);
  const shown = groups.filter((g) => g.length > 0);

  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLButtonElement>(".menu-item")?.focus();
  }, [open, ref]);

  if (shown.length === 0) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>(".menu-item") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      setOpen(false);
      button.current?.focus();
    }
  };

  return (
    <div ref={ref} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreIcon className="size-5" />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={label}>
          {shown.map((group, g) => (
            <div key={g} role="none">
              {g > 0 && <div className="menu-sep" role="separator" />}
              {group.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  className={`menu-item ${action.danger ? "menu-item-danger" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    if (!action.confirm || window.confirm(action.confirm)) action.onSelect();
                  }}
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
