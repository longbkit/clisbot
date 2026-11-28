import type { ReactNode } from "react";
import { LatestCallToolCallGroupView } from "./latest-call/view";
import { OverviewToolCallGroupView } from "./overview/view";
import type { ToolCallDetailGroup } from "./projection";

/** The row a grouped run of tool calls renders as, in whichever detail level grouped it. */
export function ToolCallGroupView({
  group,
  cwd,
  ...props
}: {
  group: ToolCallDetailGroup;
  cwd?: string;
  expanded: boolean;
  isLastInSequence: boolean;
  onExpandedChange: (groupId: string, expanded: boolean) => void;
  children: ReactNode;
}) {
  return group.mode === "overview" ? (
    <OverviewToolCallGroupView group={group} {...props} />
  ) : (
    <LatestCallToolCallGroupView group={group} cwd={cwd} {...props} />
  );
}
