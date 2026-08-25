import { cn } from "../../lib/utils.js";

/**
 * The one status pill. Tones map to the status tokens in `styles.css`; no surface
 * hardcodes a status colour or reaches for `<Badge>` to signal state.
 */
export type StatusTone = "success" | "warning" | "danger" | "neutral";

const toneStyles: Record<StatusTone, string> = {
  success: "bg-success-surface text-success",
  warning: "bg-warning-surface text-warning",
  danger: "bg-danger-surface text-danger",
  neutral: "bg-neutral-surface text-neutral",
};

export function StatusPill({
  tone,
  children,
  dot = true,
}: {
  tone: StatusTone;
  children: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs whitespace-nowrap",
        toneStyles[tone],
      )}
    >
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
