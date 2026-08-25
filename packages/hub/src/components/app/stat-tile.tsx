import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * An overview figure. The value box is a fixed height so a tile does not resize when
 * its data resolves — the loading, empty, and loaded states occupy the same box.
 */
export function StatTile({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  icon: LucideIcon;
}) {
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon aria-hidden="true" className="size-4" />
        {label}
      </div>
      <div className="grid min-h-11 content-start gap-1">
        <p className="text-2xl leading-none font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="min-h-5 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}
