import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils.js";

export function Checkbox({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-sm border border-input bg-background text-primary shadow-xs",
        "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-checked:bg-primary peer-checked:text-primary-foreground",
        className,
      )}
    >
      <Check className="hidden size-3" />
    </span>
  );
}

export function CheckboxInput({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <span className="relative grid size-4 shrink-0">
      <input
        type="checkbox"
        className="peer absolute inset-0 z-10 size-4 cursor-pointer opacity-0"
        {...props}
      />
      <Checkbox className={cn("peer-checked:[&>svg]:block", className)} />
    </span>
  );
}
