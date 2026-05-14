export type UnroutedGuidanceConversationKind = "dm" | "group" | "channel" | "topic";

export function shouldGuideUnroutedConversation(params: {
  conversationKind: UnroutedGuidanceConversationKind;
  explicitlyAddressed: boolean;
  isGuidanceCommand: boolean;
  allowCommandOnlyGuidance: boolean;
  isBotOriginated: boolean;
}) {
  if (params.isBotOriginated) {
    return false;
  }

  if (params.conversationKind === "dm") {
    return params.isGuidanceCommand;
  }

  if (params.explicitlyAddressed) {
    return true;
  }

  return params.allowCommandOnlyGuidance && params.isGuidanceCommand;
}
