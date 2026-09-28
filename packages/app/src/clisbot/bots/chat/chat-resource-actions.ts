// The actions that belong to a bot or a chat itself, whichever menu shows them: the sidebar
// row menu and the open chat's options menu list the same ones in the same order with the
// same labels. Actions that belong to the open page (tabs, Project actions, a fresh session)
// stay in the chat options menu. Pure.

export type ChatResourceActionId = "pin" | "bot-settings" | "group-settings" | "archive";

export interface ChatResourceAction {
  id: ChatResourceActionId;
  label: string;
}

export interface ChatResourceActionsInput {
  /** `bot`: a Bot row (the bot and its DM); `direct` / `group`: a chat. */
  target: "bot" | "direct" | "group";
  pinned: boolean;
  canConfigureBot?: boolean;
}

/** Pin first, settings next, archive last. A Bot row archives nothing: the row is the bot. */
export function chatResourceActions(input: ChatResourceActionsInput): ChatResourceAction[] {
  const actions: ChatResourceAction[] = [pinAction(input.pinned)];
  if (input.target !== "group" && input.canConfigureBot)
    actions.push({ id: "bot-settings", label: "Bot settings" });
  if (input.target === "group") actions.push({ id: "group-settings", label: "Group settings" });
  if (input.target !== "bot") actions.push({ id: "archive", label: "Archive chat…" });
  return actions;
}

export function pinAction(pinned: boolean): ChatResourceAction {
  return { id: "pin", label: pinned ? "Unpin" : "Pin to sidebar" };
}
