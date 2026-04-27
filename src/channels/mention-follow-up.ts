export function buildMentionOnlyFollowUpPrompt(params: {
  conversationKind: "dm" | "group" | "channel";
  threaded?: boolean;
}) {
  void params;
  return "Mentioned clisbot only. Use the above messages context to answer the latest unresolved request.";
}
