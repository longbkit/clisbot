import type { ReactNode } from "react";

import { cn } from "../../lib/utils.js";

export interface SummaryRow {
  label: string;
  value: ReactNode;
}

/**
 * What a finished piece of setup amounts to, as labelled rows rather than a stack of sentences.
 * Four anonymous lines of body text say the same words and give the eye nothing to land on; a
 * description list gives every fact a name, a place, and a shape a screen reader can navigate.
 */
export function SummaryPanel({
  label,
  rows,
  className,
}: {
  /** Identifies which summary this is, e.g. "GitHub app". */
  label: string;
  rows: readonly SummaryRow[];
  className?: string;
}) {
  return (
    <dl
      // No role override. A description list already exposes its rows as terms and definitions,
      // and naming the container costs exactly that. The attribute is a test hook, nothing more.
      data-summary={label}
      // A one-pixel gap over the border colour is the divider. No extra element, and the rows
      // reflow into one column on a phone without the rules ending up in the wrong places.
      className={cn(
        "grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2",
        className,
      )}
    >
      {rows.map((row) => (
        <div key={row.label} className="grid content-start gap-1 bg-card px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 text-sm break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
