export function buildMentionOnlyFollowUpPrompt(params: {
  conversationKind: "dm" | "group" | "channel";
  threaded?: boolean;
}) {
  const scope = params.threaded
    ? "this thread"
    : params.conversationKind === "dm"
      ? "this conversation"
      : "the recent conversation here";

  return [
    "The user explicitly mentioned you without any additional text.",
    `Review the recent context in ${scope} and respond to the latest unresolved request.`,
    "If the next step is still unclear, ask one short clarifying question.",
  ].join(" ");
}
