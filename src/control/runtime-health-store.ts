import { dirname } from "node:path";
import { fileExists, readTextFile, writeTextFile } from "../shared/fs.ts";
import { ensureDir, getDefaultRuntimeHealthPath } from "../shared/paths.ts";

export type RuntimeChannel = "slack" | "telegram";
export type RuntimeChannelConnection =
  | "disabled"
  | "stopped"
  | "starting"
  | "active"
  | "failed";

export type ChannelHealthInstance = {
  accountId: string;
  label?: string;
  appLabel?: string;
  tokenHint?: string;
};

export type ChannelHealthRecord = {
  channel: RuntimeChannel;
  connection: RuntimeChannelConnection;
  summary: string;
  detail?: string;
  actions: string[];
  instances: ChannelHealthInstance[];
  updatedAt: string;
};

type RuntimeHealthDocument = {
  channels: Partial<Record<RuntimeChannel, ChannelHealthRecord>>;
  reload?: {
    status: "success" | "failed";
    reason: "initial" | "watch";
    configMtimeMs?: number;
    detail?: string;
    updatedAt: string;
  };
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
        "run `clisbot logs` again after reinstall to confirm the missing-scope error is gone",
      ],
    };
  }

  return {
    summary: "Slack channel failed to start.",
    actions: [
      "run `clisbot logs` and inspect the latest Slack startup error",
      "verify the Slack app token, bot token, and workspace match",
      "verify Socket Mode and the required Slack scopes are enabled before restarting `clisbot`",
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
      "run `clisbot logs` again after restarting to confirm the startup error is gone",
    ],
  };
}

export class RuntimeHealthStore {
  constructor(private readonly filePath = getDefaultRuntimeHealthPath()) {}

  async read() {
    if (!(await fileExists(this.filePath))) {
      return {
        channels: {},
      } as RuntimeHealthDocument;
    }

    const text = await readTextFile(this.filePath);
    if (!text.trim()) {
      return {
        channels: {},
      } as RuntimeHealthDocument;
    }

    const parsed = JSON.parse(text) as Partial<RuntimeHealthDocument>;
    const channels = Object.fromEntries(
      Object.entries(parsed.channels ?? {}).map(([channel, record]) => [
        channel,
        {
          ...record,
          instances: record?.instances ?? [],
        },
      ]),
    ) as RuntimeHealthDocument["channels"];

    return {
      channels,
      reload: parsed.reload,
    } as RuntimeHealthDocument;
  }

  async setChannel(params: {
    channel: RuntimeChannel;
    connection: RuntimeChannelConnection;
    summary: string;
    detail?: string;
    actions?: string[];
    instances?: ChannelHealthInstance[];
  }) {
    const document = await this.read();
    document.channels[params.channel] = {
      channel: params.channel,
      connection: params.connection,
      summary: params.summary,
      detail: params.detail,
      actions: params.actions ?? [],
      instances: params.instances ?? [],
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

  async setReload(params: {
    status: "success" | "failed";
    reason: "initial" | "watch";
    configMtimeMs?: number;
    detail?: string;
  }) {
    const document = await this.read();
    document.reload = {
      status: params.status,
      reason: params.reason,
      configMtimeMs: params.configMtimeMs,
      detail: params.detail,
      updatedAt: new Date().toISOString(),
    };
    await this.write(document);
  }

  private async write(document: RuntimeHealthDocument) {
    await ensureDir(dirname(this.filePath));
    await writeTextFile(this.filePath, `${JSON.stringify(document, null, 2)}\n`);
  }
}
