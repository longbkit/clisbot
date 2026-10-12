import { useSessionStore } from "@/stores/session-store";
import { ToolCallDisplayField } from "../chat/tool-call-display-field";
import type { BotFormModel, BotFormState } from "./bot-form-model";

/** Bot settings: how the Bot's direct chat shows tool calls, when its Host keeps the setting. */
export function BotToolCallDisplayField({
  state,
  model,
  size,
}: {
  state: BotFormState;
  model: BotFormModel;
  size: "sm" | "md";
}) {
  const supported = useHostSupportsToolCallDisplay(state.selectedServerId);
  if (!supported) return null;
  return (
    <ToolCallDisplayField
      value={state.toolCallDisplay}
      onChange={model.setToolCallDisplay}
      size={size}
    />
  );
}

/** COMPAT(chatToolDisplay): an older Host drops the Bot's `display`; the field hides there. */
export function useHostSupportsToolCallDisplay(serverId: string | null): boolean {
  return useSessionStore(
    (store) =>
      serverId !== null && store.sessions[serverId]?.serverInfo?.features?.chatToolDisplay === true,
  );
}
