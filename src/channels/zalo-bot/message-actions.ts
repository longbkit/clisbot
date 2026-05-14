import { postZaloBotPhoto, postZaloBotText } from "./transport.ts";
import type { MessageInputFormat, MessageRenderMode } from "../message/message-command.ts";
import { resolveZaloBotMessageContent } from "./content.ts";

export type ZaloBotMessageActionParams = {
  botToken: string;
  target: string;
  message?: string;
  media?: string;
  inputFormat?: MessageInputFormat;
  renderMode?: MessageRenderMode;
};

export async function sendZaloBotMessageAction(params: ZaloBotMessageActionParams) {
  if (params.media) {
    if (!/^https?:\/\//i.test(params.media)) {
      throw new Error("Zalo Bot photo sends currently require an absolute HTTP or HTTPS URL.");
    }
    const resolvedCaption = params.message
      ? resolveZaloBotMessageContent({
          text: params.message,
          inputFormat: params.inputFormat ?? "md",
          renderMode: params.renderMode ?? "native",
        }).text
      : undefined;
    return await postZaloBotPhoto({
      token: params.botToken,
      chatId: params.target.trim(),
      photoUrl: params.media,
      caption: resolvedCaption,
    });
  }

  return await postZaloBotText({
    token: params.botToken,
    chatId: params.target.trim(),
    text: params.message ?? "",
    inputFormat: params.inputFormat ?? "md",
    renderMode: params.renderMode ?? "native",
  });
}

export async function unsupportedZaloBotHistoryAction(action: string) {
  return {
    ok: false,
    action,
    reason: `Zalo Bot does not support message ${action} in clisbot yet.`,
  };
}
