export const botsQueryBaseKey = ["bots"] as const;
export const chatsQueryBaseKey = ["chats"] as const;
export const chatTranscriptQueryBaseKey = ["chat-transcript"] as const;

function hostSetKey(serverIds: readonly string[]): string {
  return [...serverIds].sort().join("|");
}

/** Keys carry the host set; the hooks append the connection-status key (docs/forms.md "Data gating"). */
export function botsQueryKey(serverIds: readonly string[]) {
  return [...botsQueryBaseKey, hostSetKey(serverIds)] as const;
}

export function chatsQueryKey(serverIds: readonly string[]) {
  return [...chatsQueryBaseKey, hostSetKey(serverIds)] as const;
}

export function chatTranscriptQueryKey(serverId: string, chatId: string) {
  return [...chatTranscriptQueryBaseKey, serverId, chatId] as const;
}
