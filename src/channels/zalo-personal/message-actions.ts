import type {
  MessageInputFormat,
  MessageRenderMode,
} from "../message/message-command.ts";
import { resolveZaloBotMessageContent } from "../zalo-bot/content.ts";
import { loginZaloPersonalFromSession } from "./zca-js.ts";

export async function sendZaloPersonalMessageAction(params: {
  tokenFile: string;
  target: {
    conversationKind: "dm" | "group";
    chatId: string;
  };
  message?: string;
  media?: string;
  inputFormat?: MessageInputFormat;
  renderMode?: MessageRenderMode;
}) {
  if (params.media) {
    throw new Error("Zalo Personal message media send is not implemented in this slice.");
  }
  const text = resolveZaloBotMessageContent({
    text: params.message ?? "",
    inputFormat: params.inputFormat ?? "md",
    renderMode: params.renderMode ?? "native",
  }).text.trim();
  if (!text) {
    throw new Error("Zalo Personal message send requires non-empty text.");
  }
  const client = await loginZaloPersonalFromSession(params.tokenFile);
  const threadType = params.target.conversationKind === "dm"
    ? client.ThreadType.User
    : client.ThreadType.Group;
  return await client.api.sendMessage({ msg: text }, params.target.chatId, threadType);
}
