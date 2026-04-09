import { dirname } from "node:path";
import { fileExists, readTextFile, writeTextFile } from "../shared/fs.ts";
import { DEFAULT_RUNTIME_HEALTH_PATH, ensureDir } from "../shared/paths.ts";

export type RuntimeChannel = "slack" | "telegram";
export type RuntimeChannelConnection =
  | "disabled"
  | "stopped"
  | "starting"
  | "active"
  | "failed";

export type ChannelHealthRecord = {
  channel: RuntimeChannel;
  connection: RuntimeChannelConnection;
  summary: string;
  detail?: string;
  actions: string[];
  updatedAt: string;
};

type RuntimeHealthDocument = {
  channels: Partial<Record<RuntimeChannel, ChannelHealthRecord>>;
};

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return String(error).trim();
}

function summarizeSlackHealthError(error: unknown) {
  const detail = normalizeErrorMessage(error);
  const lowered = detail.toLowerCase();

  if (
    lowered.includes("xapp") ||
    lowered.includes("app token") ||
    lowered.includes("socket mode") ||
    lowered.includes("connections:write")
  ) {
    return {
      summary: "Socket Mode app token was rejected.",
      actions: [
        "verify `channels.slack.appToken` resolves to an `xapp-` token",
        "enable Slack Socket Mode and grant the app token `connections:write`",
        "confirm the app token and bot token belong to the same Slack app and workspace",
      ],
    };
  }

  if (
    lowered.includes("invalid_auth") ||
    lowered.includes("not_authed") ||
    lowered.includes("account_inactive") ||
    lowered.includes("token")
  ) {
    return {
      summary: "Slack token authentication failed.",
      actions: [
        "verify `channels.slack.botToken` resolves to a valid `xoxb-` token",
        "confirm the Slack app was installed to the target workspace after the latest token rotation",
        "confirm the bot token and app token belong to the same Slack app and workspace",
      ],
    };
  }

  if (lowered.includes("missing_scope") || lowered.includes("scope")) {
    return {
      summary: "Slack app permissions are incomplete.",
      actions: [
        "add the missing Slack scopes and event subscriptions for the routes you expect to handle",
        "reinstall the Slack app after changing scopes",
        "run `muxbot logs` again after reinstall to confirm the missing-scope error is gone",
      ],
    };
  }

  return {
    summary: "Slack channel failed to start.",
    actions: [
      "run `muxbot logs` and inspect the latest Slack startup error",
      "verify the Slack app token, bot token, and workspace match",
      "verify Socket Mode and the required Slack scopes are enabled before restarting `muxbot`",
    ],
  };
}

function summarizeTelegramHealthError(error: unknown) {
  return {
    summary: "Telegram channel failed to start.",
    detail: normalizeErrorMessage(error),
    actions: [
      "verify `channels.telegram.botToken` resolves to the intended bot token",
      "confirm no other Telegram bot instance is polling the same token",
      "run `muxbot logs` again after restarting to confirm the startup error is gone",
    ],
  };
}

export class RuntimeHealthStore {
  constructor(private readonly filePath = DEFAULT_RUNTIME_HEALTH_PATH) {}

  async read() {
    if (!(await fileExists(this.filePath))) {
      return {
        channels: {},
      } satisfies RuntimeHealthDocument;
    }

    const text = await readTextFile(this.filePath);
    if (!text.trim()) {
      return {
        channels: {},
      } satisfies RuntimeHealthDocument;
    }

    const parsed = JSON.parse(text) as Partial<RuntimeHealthDocument>;
    return {
      channels: parsed.channels ?? {},
    } satisfies RuntimeHealthDocument;
  }

  async setChannel(params: {
    channel: RuntimeChannel;
    connection: RuntimeChannelConnection;
    summary: string;
    detail?: string;
    actions?: string[];
  }) {
    const document = await this.read();
    document.channels[params.channel] = {
      channel: params.channel,
      connection: params.connection,
      summary: params.summary,
      detail: params.detail,
      actions: params.actions ?? [],
      updatedAt: new Date().toISOString(),
    };
    await this.write(document);
  }

  async markSlackFailure(error: unknown) {
    const diagnostic = summarizeSlackHealthError(error);
    await this.setChannel({
      channel: "slack",
      connection: "failed",
      summary: diagnostic.summary,
      detail: normalizeErrorMessage(error),
      actions: diagnostic.actions,
    });
  }

  async markTelegramFailure(error: unknown) {
    const diagnostic = summarizeTelegramHealthError(error);
    await this.setChannel({
      channel: "telegram",
      connection: "failed",
      summary: diagnostic.summary,
      detail: diagnostic.detail,
      actions: diagnostic.actions,
    });
  }

  private async write(document: RuntimeHealthDocument) {
    await ensureDir(dirname(this.filePath));
    await writeTextFile(this.filePath, `${JSON.stringify(document, null, 2)}\n`);
  }
}
