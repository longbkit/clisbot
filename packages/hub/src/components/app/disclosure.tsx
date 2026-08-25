import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.js";

/**
 * A bordered card whose header is the whole open/close target. Independent by construction —
 * each one owns its own `open`, so several can stand side by side without an accordion's
 * single-open rule closing the section someone is still typing into.
 *
 * The body is force-mounted: a half-filled form has to survive being collapsed, which a
 * conditionally rendered body cannot do. Radix hides it with `hidden`, so a collapsed section
 * is still invisible to sighted users, assistive technology, and test visibility checks.
 */
export function Disclosure({
  id,
  open,
  onOpenChange,
  media,
  title,
  description,
  status,
  children,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The brand mark. Decorative — the title carries the name. */
  media?: ReactNode;
  title: string;
  description?: string;
  /** The single status indicator, rendered before the chevron. */
  status?: ReactNode;
  children: ReactNode;
}) {
  const headerId = `${id}-header`;
  const bodyId = `${id}-body`;
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="min-w-0 rounded-lg border bg-card"
      data-provider={id}
    >
      <CollapsibleTrigger
        id={headerId}
        aria-controls={bodyId}
        className={cn(
          "grid w-full min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-4 py-3 text-left sm:flex sm:gap-3",
          "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "hover:bg-accent/40",
        )}
      >
        {media === undefined ? null : (
          <span aria-hidden="true" className="flex shrink-0 items-center">
            {media}
          </span>
        )}
        <span className="contents sm:grid sm:min-w-0 sm:flex-1 sm:gap-0.5">
          <span className="col-start-2 row-start-1 truncate font-medium sm:col-auto sm:row-auto">
            {title}
          </span>
          {description === undefined ? null : (
            <span className="col-span-3 row-start-2 text-sm text-muted-foreground sm:col-auto sm:row-auto">
              {description}
            </span>
          )}
        </span>
        <span className="contents sm:flex sm:shrink-0 sm:items-center sm:gap-2">
          <span className="col-span-3 row-start-3 justify-self-start sm:col-auto sm:row-auto">
            {status}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "col-start-3 row-start-1 size-4 text-muted-foreground transition-transform sm:col-auto sm:row-auto",
              open ? "rotate-180" : "",
            )}
          />
        </span>
      </CollapsibleTrigger>
      {/* `forceMount` keeps the body in the DOM but stops Radix hiding it, so the closed state
          is ours to apply. `display: none` is what removes it from the page, the accessibility
          tree, and the tab order while leaving every typed value intact. */}
      <CollapsibleContent
        forceMount
        id={bodyId}
        role="region"
        aria-labelledby={headerId}
        className="min-w-0 overflow-hidden border-t px-4 py-5 data-[state=closed]:hidden"
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
