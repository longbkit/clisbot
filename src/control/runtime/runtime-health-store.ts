import { dirname } from "node:path";
import type { ChannelId } from "../../channels/integration/channel-surface-contract.ts";
import { fileExists, readTextFile, writeTextFile } from "../../infra/fs.ts";
import { ensureDir, getDefaultRuntimeHealthPath } from "../../infra/paths.ts";

export type RuntimeChannel = ChannelId;
export type RuntimeChannelConnection =
  | "disabled"
  | "stopped"
  | "starting"
  | "active"
  | "failed";

export type ChannelHealthInstance = {
  botId: string;
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

type ChannelStartupFailureDiagnostic = {
  summary: string;
  detail?: string;
  actions: string[];
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
          instances: (record?.instances ?? []).map((instance) => {
            const legacyAccountId = (instance as unknown as { accountId?: unknown })?.accountId;
            const { accountId: _legacyAccountId, ...rest } = instance as unknown as {
              accountId?: string;
              [key: string]: unknown;
            };
            return {
              ...rest,
              botId:
                typeof instance?.botId === "string" && instance.botId.trim()
                  ? instance.botId
                  : typeof legacyAccountId === "string" && legacyAccountId.trim()
                    ? legacyAccountId
                    : "unknown",
            };
          }),
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

  async markFailure(params: {
    channel: RuntimeChannel;
    error: unknown;
    diagnostic: ChannelStartupFailureDiagnostic;
  }) {
    await this.setChannel({
      channel: params.channel,
      connection: "failed",
      summary: params.diagnostic.summary,
      detail: params.diagnostic.detail ?? normalizeErrorMessage(params.error),
      actions: params.diagnostic.actions,
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
