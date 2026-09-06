import type { ResolveConversationFn } from "@getpaseo/channels-shared";
import {
  buildTelegramClientOptions,
  createTelegramApi,
  resolveTelegramAccount,
  type TelegramCfg,
} from "./client/bot-api.js";

export const resolveTelegramConversation: ResolveConversationFn = async ({
  cfg,
  accountId,
  to,
}) => {
  const account = resolveTelegramAccount(cfg as TelegramCfg, accountId);
  const api = await createTelegramApi(
    account.token,
    buildTelegramClientOptions({ ...account, config: { ...account.config, timeoutSeconds: 5 } }),
  );
  const chat = await api.getChat(to);
  if (String(chat.id) !== to) return null;
  let kind: "dm" | "group" | "channel" = "group";
  if (chat.type === "private") kind = "dm";
  else if (chat.type === "channel") kind = "channel";
  return {
    label: chat.title?.trim().slice(0, 200) || null,
    kind,
    visibility: chat.type === "private" ? "private" : "unknown",
  };
};
