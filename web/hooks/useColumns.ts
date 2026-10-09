"use client";

import { useSyncExternalStore } from "react";

/** Screen widths (px) where a list gains a column: the same breakpoints as Tailwind's `md` and `xl`. */
const TWO = 768;
const THREE = 1280;

function subscribe(onChange: () => void) {
  const queries = [TWO, THREE].map((width) => window.matchMedia(`(min-width: ${width}px)`));
  queries.forEach((q) => q.addEventListener("change", onChange));
  return () => queries.forEach((q) => q.removeEventListener("change", onChange));
}

const read = () => (window.matchMedia(`(min-width: ${THREE}px)`).matches ? 3 : window.matchMedia(`(min-width: ${TWO}px)`).matches ? 2 : 1);

/** How many columns a masonry list has at this screen width: 1, 2 or 3, and at most `max`. One on the server, where there is no screen. */
export const useColumns = (max = 3) =>
  Math.min(
    useSyncExternalStore(subscribe, read, () => 1),
    max,
  );
