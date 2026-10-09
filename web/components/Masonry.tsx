"use client";

import type { ReactNode } from "react";
import { useColumns } from "@/hooks/useColumns";
import { toColumns } from "@/lib/timeline";

/**
 * Cards of different heights in columns without gaps: a grid places them row by row, so a short
 * card sits above a hole beside a tall one. Each item (newest or most important first) goes under
 * the shortest column by `height`, an estimate, so there are no holes inside a column and loading
 * more items never moves the ones already shown. The columns follow the screen: 1, 2 or 3, at most `maxColumns`.
 * `as="ul"` makes each column a list, for items that are `<li>`s.
 */
export function Masonry<T>({
  items,
  height,
  render,
  maxColumns = 3,
  as: Tag = "div",
  gap = "gap-4",
}: {
  items: readonly T[];
  height: (item: T) => number;
  render: (item: T) => ReactNode;
  maxColumns?: number;
  as?: "div" | "ul";
  gap?: string;
}) {
  const columns = useColumns(maxColumns);
  return (
    <div className={`grid items-start ${gap}`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {toColumns(items, columns, height).map((column, i) => (
        <Tag key={i} className={`flex min-w-0 flex-col ${gap}`}>
          {column.map(render)}
        </Tag>
      ))}
    </div>
  );
}
