import type { AgentSlashCommand } from "../../agents/commands.ts";
import { shouldGuideUnroutedConversation } from "../unrouted-guidance-policy.ts";
import {
  hasForeignTelegramMention,
  hasTelegramBotMention,
} from "./message.ts";
import type { TelegramConversationKind } from "./session-routing.ts";

export type TelegramUnroutedGuidanceMode = "start" | "help" | "status" | "whoami";

export function resolveTelegramUnroutedGuidanceMode(
  slashCommand: AgentSlashCommand,
): TelegramUnroutedGuidanceMode | null {
  if (
    slashCommand?.type === "control" &&
    (
      slashCommand.name === "start" ||
      slashCommand.name === "help" ||
      slashCommand.name === "status" ||
      slashCommand.name === "whoami"
    )
  ) {
    return slashCommand.name;
  }

  return null;
}

export function resolveTelegramUnroutedGuidanceModeForEvent(params: {
  conversationKind: TelegramConversationKind;
  rawText: string;
  botUsername?: string;
  slashCommand: AgentSlashCommand;
  isBotOriginated: boolean;
}) {
  if (hasForeignTelegramMention(params.rawText, params.botUsername)) {
    return null;
  }

  const guidanceMode = resolveTelegramUnroutedGuidanceMode(params.slashCommand);
  const shouldGuide = shouldGuideUnroutedConversation({
    conversationKind: params.conversationKind === "topic" ? "topic" : params.conversationKind,
    explicitlyAddressed: hasTelegramBotMention(params.rawText, params.botUsername),
    isGuidanceCommand: guidanceMode !== null,
    allowCommandOnlyGuidance: true,
    isBotOriginated: params.isBotOriginated,
  });

  if (!shouldGuide) {
    return null;
  }

  return guidanceMode ?? "start";
}
