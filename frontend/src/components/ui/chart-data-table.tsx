"use client";

import { useId } from "react";

export interface ChartColumn<T> {
  /** Header label for this column. */
  key: string;
  /** Extract the cell value for a given data row. */
  value: (row: T) => string | number | null | undefined;
}

interface ChartDataTableProps<T> {
  /** Caption describing what the chart shows (used as the table caption + chart aria-label). */
  caption: string;
  /** The same data array the chart is rendering. */
  data: T[];
  /** Column definitions, in display order. */
  columns: ChartColumn<T>[];
}

/**
 * A visually-hidden data table that mirrors a chart's underlying data, exposing
 * it to screen readers. Recharts renders to SVG with no inherent tabular
 * semantics, so a sighted user sees the chart and an assistive-tech user reads
 * this table. The two stay in sync because both are fed the same `data` array.
 *
 * Usage: place this as a sibling inside the chart's container, and put
 * `role="img"` + `aria-label={caption}` on the visual chart wrapper so it is
 * announced once, with the table providing the detail on demand.
 *
 * Renders nothing when there is no data.
 */
export function ChartDataTable<T>({ caption, data, columns }: ChartDataTableProps<T>) {
  const id = useId();
  if (!data || data.length === 0) return null;

  const fmt = (v: string | number | null | undefined) => {
    if (v == null) return "—";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return "—";
      // Trim noisy float tails without forcing a fixed precision on integers.
      return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
    }
    return String(v);
  };

  return (
    <table className="sr-only" aria-describedby={`${id}-cap`}>
      <caption id={`${id}-cap`}>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col">{c.key}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, ri) => (
          <tr key={ri}>
            {columns.map((c) => (
              <td key={c.key}>{fmt(c.value(row))}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
