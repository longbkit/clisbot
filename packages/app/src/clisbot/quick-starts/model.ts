import type { ReactNode } from "react";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { QuickStartTarget, QuickStartInput } from "@clisbot/protocol/quick-starts/types";
export interface QuickStartDestination {
  option: ComboboxOption;
  target: QuickStartTarget;
  avatar?: ReactNode;
  /** The same mark at another size, for a compact trigger. Projects use their own icon. */
  mark?: (size: number) => ReactNode;
  testID?: string;
  /** The Host this destination runs on. */
  serverId?: string;
  cwd?: string;
  worktreeSupport?: "supported" | "unsupported" | "unknown";
}
export interface QuickStartEdit {
  id: string;
  revision: number;
  input: QuickStartInput;
}
export function targetKey(target: QuickStartTarget) {
  if (target.kind === "bot") return `bot:${target.botId}`;
  if (target.kind === "project") return `project:${target.projectId}`;
  return "quickChat";
}
export function findDestination(destinations: QuickStartDestination[], target: QuickStartTarget) {
  return destinations.find((entry) => targetKey(entry.target) === targetKey(target));
}
