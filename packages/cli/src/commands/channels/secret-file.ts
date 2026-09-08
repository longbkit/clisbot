// COMPAT(clisbot-control-plane): `channels add --secret-file` — one channel's
// credential, read from a file rather than argv.
//
// A credential never rides in argv: it would land in `ps` output and in shell
// history. The file is the whole interface, so its accepted shapes are the whole
// contract:
//
//  * bot-token channels (Telegram, Discord, Zalo) — a raw token, or a JSON
//    object with `botToken` (and, for Zalo webhook mode, `webhookSecret`);
//  * Feishu — a JSON object with `appId` + `appSecret` (plus the optional
//    `verificationToken`, `encryptKey` and `domain`);
//  * Google Chat — the service-account JSON document itself (the file the
//    Google Cloud console downloads, recognised by its `client_email`), or a
//    JSON object naming `serviceAccount` / `serviceAccountFile`.
//
// The file is never echoed: a shape error names the missing FIELD, never a value.

import { readFileSync } from "node:fs";
import type { ChannelAddInput, FeishuCredential, GoogleChatCredential } from "./client.js";

export function readSecretFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "SECRET_FILE_UNREADABLE",
      message: `Cannot read secret file ${filePath}: ${message}`,
    };
  }
}

function invalid(message: string): never {
  throw { code: "SECRET_FILE_INVALID", message };
}

/** The file as a JSON object, or `undefined` when it is a plain secret. */
function asRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function field(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function optional(record: Record<string, unknown> | undefined, key: string) {
  const value = field(record, key);
  return value === undefined ? {} : { [key]: value };
}

/** A raw token file is the preferred shape; `{ "botToken": … }` also works. */
export function readBotTokenSecret(contents: string): {
  botToken: string;
  webhookSecret?: string;
} {
  const record = asRecord(contents);
  if (record === undefined) return { botToken: contents.trim() };
  const botToken = field(record, "botToken");
  if (botToken === undefined) invalid("The secret file must contain `botToken`.");
  return { botToken, ...optional(record, "webhookSecret") } as {
    botToken: string;
    webhookSecret?: string;
  };
}

export function readFeishuSecret(contents: string): FeishuCredential {
  const record = asRecord(contents);
  const appId = field(record, "appId");
  const appSecret = field(record, "appSecret");
  if (appId === undefined || appSecret === undefined) {
    invalid("The Feishu secret file must contain `appId` and `appSecret`.");
  }
  const domain = field(record, "domain");
  if (domain !== undefined && domain !== "feishu" && domain !== "lark") {
    invalid("`domain` must be `feishu` or `lark`.");
  }
  return {
    appId,
    appSecret,
    ...optional(record, "verificationToken"),
    ...optional(record, "encryptKey"),
    ...(domain === undefined ? {} : { domain }),
  } as FeishuCredential;
}

export function readGoogleChatSecret(contents: string): GoogleChatCredential {
  const record = asRecord(contents);
  if (record === undefined) invalid("The Google Chat secret file must be JSON.");
  // The file the Google Cloud console downloads IS the credential; recognise it
  // rather than making the operator wrap it in another object.
  if (field(record, "client_email") !== undefined) return { serviceAccount: contents };
  const serviceAccountFile = field(record, "serviceAccountFile");
  if (serviceAccountFile !== undefined) return { serviceAccountFile };
  const serviceAccount = record["serviceAccount"];
  if (typeof serviceAccount === "string" && serviceAccount.trim() !== "") {
    return { serviceAccount: serviceAccount.trim() };
  }
  if (serviceAccount !== null && typeof serviceAccount === "object") {
    return { serviceAccount: JSON.stringify(serviceAccount) };
  }
  invalid(
    "The Google Chat secret file must be a service-account document, or name `serviceAccount` or `serviceAccountFile`.",
  );
}

/** The `channels add` body for one channel, from its secret file. */
export function channelCredentialFromFile(
  channel: string,
  account: string,
  contents: string,
): ChannelAddInput {
  if (channel === "feishu") return { channel, account, ...readFeishuSecret(contents) };
  if (channel === "googlechat") return { channel, account, ...readGoogleChatSecret(contents) };
  if (channel === "telegram" || channel === "discord" || channel === "zalo") {
    return { channel, account, ...readBotTokenSecret(contents) };
  }
  throw { code: "INVALID_CHANNEL", message: `Unsupported channel: ${channel}` };
}
