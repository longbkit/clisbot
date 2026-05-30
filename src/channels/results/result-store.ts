import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getDefaultChannelResultsPath } from "../../infra/paths.ts";
import type { ChannelId } from "../integration/channel-surface-contract.ts";

export type ChannelResultStatus =
  | "received"
  | "filtered"
  | "duplicate"
  | "queued"
  | "steered"
  | "processing"
  | "completed"
  | "failed"
  | "expired"
  | "stopped";

export type ChannelResultOutputKind = "progress" | "final";
export type ChannelResultRender = "text" | "markdown";

export type ChannelResultOutput = {
  sequence: number;
  kind: ChannelResultOutputKind;
  text: string;
  render: ChannelResultRender;
  createdAt: string;
};

export type ChannelResultError = {
  code: string;
  message: string;
  category?: string;
};

export type ChannelResultRecord = {
  channel: ChannelId;
  botId: string;
  eventId: string;
  status: ChannelResultStatus;
  progress: ChannelResultOutput[];
  result: ChannelResultOutput | null;
  error: ChannelResultError | null;
  expiresAt: string;
  updatedAt: string;
  surfaceId?: string;
  surfaceKind?: "dm" | "group";
  agentId?: string;
  sessionKey?: string;
  reply?: {
    targetId?: string;
    params?: Record<string, unknown>;
  };
};

export type ChannelSurfaceReplyRecord = {
  channel: ChannelId;
  botId: string;
  surfaceId: string;
  surfaceKind?: "dm" | "group";
  agentId?: string;
  sessionKey?: string;
  targetId?: string;
  params?: Record<string, unknown>;
  activeEventId?: string;
  updatedAt: string;
};

type StoreDocument = {
  results: Record<string, ChannelResultRecord>;
  surfaces: Record<string, ChannelSurfaceReplyRecord>;
};

const DEFAULT_RETENTION_MS = 6 * 60 * 60 * 1000;
const EXPIRED_RECORD_GRACE_MS = 60 * 60 * 1000;
const MAX_PROGRESS_ITEMS = 20;
const MAX_OUTPUT_TEXT_CHARS = 12_000;
const TRUNCATED_MARKER = "\n[truncated]";

function buildResultKey(params: { channel: ChannelId; botId: string; eventId: string }) {
  return `${params.channel}:${params.botId}:${params.eventId}`;
}

export function buildSurfaceResultKey(params: {
  channel: ChannelId;
  botId: string;
  surfaceId: string;
}) {
  return `${params.channel}:${params.botId}:${params.surfaceId}`;
}

function truncateText(text: string) {
  if (text.length <= MAX_OUTPUT_TEXT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_OUTPUT_TEXT_CHARS - TRUNCATED_MARKER.length)}${TRUNCATED_MARKER}`;
}

function isExpired(record: Pick<ChannelResultRecord, "expiresAt">, now = Date.now()) {
  return Date.parse(record.expiresAt) <= now;
}

function sanitizeProgress(progress: ChannelResultOutput[]) {
  return progress.slice(-MAX_PROGRESS_ITEMS);
}

export class ChannelResultStore {
  private loaded = false;
  private document: StoreDocument = { results: {}, surfaces: {} };

  constructor(
    private readonly filePath = getDefaultChannelResultsPath(),
    private readonly retentionMs = DEFAULT_RETENTION_MS,
  ) {}

  private async load() {
    if (this.loaded) {
      return;
    }

    try {
      this.document = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch {
      this.document = { results: {}, surfaces: {} };
    }

    this.loaded = true;
    this.prune();
  }

  private prune() {
    const now = Date.now();
    for (const [key, record] of Object.entries(this.document.results)) {
      const expiresAt = Date.parse(record.expiresAt);
      if (Number.isNaN(expiresAt) || now - expiresAt > EXPIRED_RECORD_GRACE_MS) {
        delete this.document.results[key];
      } else if (expiresAt <= now && record.status !== "expired") {
        this.document.results[key] = {
          ...record,
          status: "expired",
          updatedAt: new Date(now).toISOString(),
        };
      }
    }
  }

  private async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.document, null, 2));
  }

  async hasResult(params: { channel: ChannelId; botId: string; eventId: string }) {
    await this.load();
    return Boolean(this.document.results[buildResultKey(params)]);
  }

  async getResult(params: { channel: ChannelId; botId: string; eventId: string }) {
    await this.load();
    const key = buildResultKey(params);
    const record = this.document.results[key];
    if (!record) {
      return null;
    }
    if (record.status !== "expired" && isExpired(record)) {
      const next = { ...record, status: "expired" as const, updatedAt: new Date().toISOString() };
      this.document.results[key] = next;
      await this.save();
      return next;
    }
    return record;
  }

  async createResult(params: {
    channel: ChannelId;
    botId: string;
    eventId: string;
    status?: ChannelResultStatus;
    surfaceId?: string;
    surfaceKind?: "dm" | "group";
    agentId?: string;
    sessionKey?: string;
    reply?: ChannelResultRecord["reply"];
  }) {
    await this.load();
    const now = new Date();
    const record: ChannelResultRecord = {
      channel: params.channel,
      botId: params.botId,
      eventId: params.eventId,
      status: params.status ?? "received",
      progress: [],
      result: null,
      error: null,
      expiresAt: new Date(now.getTime() + this.retentionMs).toISOString(),
      updatedAt: now.toISOString(),
      surfaceId: params.surfaceId,
      surfaceKind: params.surfaceKind,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      reply: params.reply,
    };
    this.document.results[buildResultKey(params)] = record;
    if (params.surfaceId || params.reply) {
      this.upsertSurfaceReplyInMemory({
        channel: params.channel,
        botId: params.botId,
        surfaceId: params.surfaceId ?? params.eventId,
        surfaceKind: params.surfaceKind,
        agentId: params.agentId,
        sessionKey: params.sessionKey,
        targetId: params.reply?.targetId,
        params: params.reply?.params,
        activeEventId: params.eventId,
      });
    }
    await this.save();
    return record;
  }

  async updateStatus(params: {
    channel: ChannelId;
    botId: string;
    eventId: string;
    status: ChannelResultStatus;
    error?: ChannelResultError | null;
  }) {
    await this.load();
    const key = buildResultKey(params);
    const record = this.document.results[key];
    if (!record) {
      return null;
    }
    const next = {
      ...record,
      status: params.status,
      error: params.error === undefined ? record.error : params.error,
      updatedAt: new Date().toISOString(),
    };
    this.document.results[key] = next;
    await this.save();
    return next;
  }

  async updateContext(params: {
    channel: ChannelId;
    botId: string;
    eventId: string;
    surfaceId?: string;
    surfaceKind?: "dm" | "group";
    agentId?: string;
    sessionKey?: string;
  }) {
    await this.load();
    const key = buildResultKey(params);
    const record = this.document.results[key];
    if (!record) {
      return null;
    }
    const next = {
      ...record,
      surfaceId: params.surfaceId ?? record.surfaceId,
      surfaceKind: params.surfaceKind ?? record.surfaceKind,
      agentId: params.agentId ?? record.agentId,
      sessionKey: params.sessionKey ?? record.sessionKey,
      updatedAt: new Date().toISOString(),
    };
    this.document.results[key] = next;
    if (next.surfaceId) {
      this.upsertSurfaceReplyInMemory({
        channel: next.channel,
        botId: next.botId,
        surfaceId: next.surfaceId,
        surfaceKind: next.surfaceKind,
        agentId: next.agentId,
        sessionKey: next.sessionKey,
        targetId: next.reply?.targetId,
        params: next.reply?.params,
        activeEventId: next.eventId,
      });
    }
    await this.save();
    return next;
  }

  async appendOutput(params: {
    channel: ChannelId;
    botId: string;
    eventId: string;
    kind: ChannelResultOutputKind;
    text: string;
    render?: ChannelResultRender;
  }) {
    await this.load();
    const key = buildResultKey(params);
    const record = this.document.results[key];
    if (!record) {
      return null;
    }
    const sequence = Math.max(0, ...record.progress.map((item) => item.sequence), record.result?.sequence ?? 0) + 1;
    const output: ChannelResultOutput = {
      sequence,
      kind: params.kind,
      text: truncateText(params.text),
      render: params.render ?? "text",
      createdAt: new Date().toISOString(),
    };
    const next: ChannelResultRecord = {
      ...record,
      progress: params.kind === "progress" ? sanitizeProgress([...record.progress, output]) : record.progress,
      result: params.kind === "final" ? output : record.result,
      status: params.kind === "final" ? "completed" : record.status === "received" ? "processing" : record.status,
      updatedAt: output.createdAt,
    };
    this.document.results[key] = next;
    await this.save();
    return next;
  }

  async upsertSurfaceReply(params: Omit<ChannelSurfaceReplyRecord, "updatedAt">) {
    await this.load();
    this.upsertSurfaceReplyInMemory(params);
    await this.save();
  }

  private upsertSurfaceReplyInMemory(params: Omit<ChannelSurfaceReplyRecord, "updatedAt">) {
    this.document.surfaces[buildSurfaceResultKey(params)] = {
      ...params,
      updatedAt: new Date().toISOString(),
    };
  }

  async resolveSurfaceReply(params: { channel: ChannelId; botId: string; surfaceId: string }) {
    await this.load();
    return this.document.surfaces[buildSurfaceResultKey(params)] ?? null;
  }
}
