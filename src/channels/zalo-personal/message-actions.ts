import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type {
  MessageInputFormat,
  MessageRenderMode,
} from "../message/message-command.ts";
import { loginZaloPersonalFromSession } from "./zca-js.ts";
import { renderZaloPersonalMessage } from "./message-render.ts";

export async function sendZaloPersonalMessageAction(params: {
  tokenFile: string;
  target: {
    conversationKind: "dm" | "group";
    chatId: string;
  };
  message?: string;
  media?: string;
  fileType?: "auto" | "file" | "image" | "video" | "audio" | "voice";
  inputFormat?: MessageInputFormat;
  renderMode?: MessageRenderMode;
}) {
  const rendered = renderZaloPersonalMessage({
    text: params.message ?? "",
    inputFormat: params.inputFormat ?? "md",
    renderMode: params.renderMode ?? "native",
  });
  if (!rendered.text && !params.media) {
    throw new Error("Zalo Personal message send requires non-empty text.");
  }
  const client = await loginZaloPersonalFromSession(params.tokenFile);
  const threadType = resolveThreadType(client, params.target.conversationKind);
  if (params.media && params.fileType === "voice") {
    const uploaded = await client.api.uploadAttachment(await toAttachmentSource(params.media), params.target.chatId, threadType);
    const fileUrl = resolveFirstUploadedFileUrl(uploaded);
    if (!fileUrl) throw new Error("Zalo Personal upload did not return a voice file URL.");
    const message = rendered.text ? await client.api.sendMessage({ msg: rendered.text }, params.target.chatId, threadType) : null;
    const voice = await client.api.sendVoice({ voiceUrl: fileUrl }, params.target.chatId, threadType);
    return { message, voice };
  }
  return await client.api.sendMessage({
    msg: rendered.text,
    ...(rendered.styles ? { styles: rendered.styles } : {}),
    ...(rendered.mentions ? { mentions: rendered.mentions } : {}),
    ...(params.media ? { attachments: await toAttachmentSource(params.media) } : {}),
  }, params.target.chatId, threadType);
}

export async function reactZaloPersonalMessageAction(params: {
  tokenFile: string;
  target: { conversationKind: "dm" | "group"; chatId: string };
  messageId: string;
  emoji: string;
  remove?: boolean;
}) {
  const client = await loginZaloPersonalFromSession(params.tokenFile);
  const locator = parseMessageLocator(params.messageId);
  return await client.api.addReaction(
    params.remove ? { rType: -1, source: 6, icon: "" } : { rType: 75, source: 6, icon: params.emoji },
    {
      data: { msgId: locator.msgId, cliMsgId: locator.cliMsgId },
      threadId: params.target.chatId,
      type: resolveThreadType(client, params.target.conversationKind),
    },
  );
}

export async function readZaloPersonalMessageAction(params: {
  tokenFile: string;
  target: { conversationKind: "dm" | "group"; chatId: string };
  limit?: number;
}) {
  if (params.target.conversationKind !== "group") {
    throw new Error("zca-js exposes group chat history only; Zalo Personal DM read is not supported by the current API.");
  }
  const client = await loginZaloPersonalFromSession(params.tokenFile);
  return await client.api.getGroupChatHistory(params.target.chatId, params.limit ?? 20);
}

export async function deleteZaloPersonalMessageAction(params: {
  tokenFile: string;
  target: { conversationKind: "dm" | "group"; chatId: string };
  messageId: string;
  confirm?: boolean;
}) {
  if (!params.confirm) throw new Error("Zalo Personal message delete mutates chat state and requires --confirm.");
  const client = await loginZaloPersonalFromSession(params.tokenFile);
  const locator = parseMessageLocator(params.messageId, String(client.api.getOwnId?.() ?? ""));
  return await client.api.deleteMessage({
    data: {
      msgId: locator.msgId,
      cliMsgId: locator.cliMsgId,
      uidFrom: locator.uidFrom,
    },
    threadId: params.target.chatId,
    type: resolveThreadType(client, params.target.conversationKind),
  });
}

function resolveThreadType(client: Awaited<ReturnType<typeof loginZaloPersonalFromSession>>, kind: "dm" | "group") {
  return kind === "dm" ? client.ThreadType.User : client.ThreadType.Group;
}

function parseMessageLocator(raw: string, defaultUidFrom = "") {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    return {
      msgId: String(parsed.msgId ?? ""),
      cliMsgId: String(parsed.cliMsgId ?? parsed.msgId ?? ""),
      uidFrom: String(parsed.uidFrom ?? defaultUidFrom),
    };
  }
  const [msgId, cliMsgId = msgId, uidFrom = defaultUidFrom] = trimmed.split(":");
  if (!msgId || !cliMsgId) {
    throw new Error("--message-id must be <msgId>[:<cliMsgId>[:<uidFrom>]] or a JSON message locator.");
  }
  return { msgId, cliMsgId, uidFrom };
}

async function toAttachmentSource(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const data = await readFile(pathOrUrl);
  const filename = basename(pathOrUrl);
  if (!filename.includes(".")) throw new Error("--file path must include an extension.");
  return {
    data,
    filename: filename as `${string}.${string}`,
    metadata: { totalSize: data.length },
  };
}

function resolveFirstUploadedFileUrl(uploaded: Array<{ fileUrl?: string; normalUrl?: string }>) {
  return uploaded.find((item) => item.fileUrl || item.normalUrl)?.fileUrl ??
    uploaded.find((item) => item.fileUrl || item.normalUrl)?.normalUrl;
}
