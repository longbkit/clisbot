import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../ui/dropdown-menu.js";
import { ConfirmationScope } from "./confirm-action.js";

/**
 * Row-level actions live behind one kebab so tables carry records, not controls.
 * Anything that would otherwise put a button or a form inside a cell goes here.
 * The confirmation scope wraps the menu rather than sitting inside it, so a dialog
 * opened from an item survives the menu closing.
 */
export function RowActions({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ConfirmationScope>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={label}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </ConfirmationScope>
  );
}
