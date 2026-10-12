import type { ComboboxOption } from "@/components/ui/combobox";
import type { QuickStartDestination } from "@/clisbot/quick-starts/model";
import { isQuickChatPath } from "@/clisbot/quick-chats/quick-chat-projects";

export type StartKind = "project" | "quickChat" | "bot";

/**
 * Whether a daemon Project is offered under Projects. A Bot's home and the Quick chat folder are
 * Projects to the daemon, but each already has its own entry.
 */
export function offersAsProject(
  projectId: string,
  directory: string | null | undefined,
  botProjectIds: ReadonlySet<string>,
  quickChatRoot: string | null | undefined,
): boolean {
  return !botProjectIds.has(projectId) && !isQuickChatPath(directory, quickChatRoot);
}

const KIND_GROUP = { quickChat: "Quick chat", project: "Projects", bot: "Bots" } as const;
/** The picker opened from a mode lists that mode's group first. */
export function orderStartOptions(
  destinations: QuickStartDestination[],
  kind: StartKind,
): ComboboxOption[] {
  const first = KIND_GROUP[kind];
  const options = destinations.map((entry) => entry.option);
  return [
    ...options.filter((option) => option.group === first),
    ...options.filter((option) => option.group !== first),
  ];
}
