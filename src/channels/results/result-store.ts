import { getDefaultChannelResultsPath } from "../../infra/paths.ts";
import { readJsonFile, withJsonFileMutation } from "../../infra/json-storage.ts";
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

function createEmptyDocument(): StoreDocument {
  return { results: {}, surfaces: {} };
}

function isRecordMap(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeDocument(value: unknown): StoreDocument {
  if (!isRecordMap(value)) {
    return createEmptyDocument();
  }
  return {
    results: isRecordMap(value.results)
      ? value.results as Record<string, ChannelResultRecord>
      : {},
    surfaces: isRecordMap(value.surfaces)
      ? value.surfaces as Record<string, ChannelSurfaceReplyRecord>
      : {},
  };
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
  constructor(
    private readonly filePath = getDefaultChannelResultsPath(),
    private readonly retentionMs = DEFAULT_RETENTION_MS,
  ) {}

  private async readDocument() {
    const document = await readJsonFile(this.filePath, {
      fallback: createEmptyDocument,
      normalize: normalizeDocument,
    });
    this.prune(document);
    return document;
  }

  private async mutateDocument<TResult>(
    mutator: (document: StoreDocument) => TResult | Promise<TResult>,
  ) {
    return await withJsonFileMutation(
      this.filePath,
      {
        fallback: createEmptyDocument,
        normalize: normalizeDocument,
      },
      async (document) => {
        this.prune(document);
        return await mutator(document);
      },
    );
  }

  private prune(document: StoreDocument) {
    const now = Date.now();
    for (const [key, record] of Object.entries(document.results)) {
      const expiresAt = Date.parse(record.expiresAt);
      if (Number.isNaN(expiresAt) || now - expiresAt > EXPIRED_RECORD_GRACE_MS) {
        delete document.results[key];
      } else if (expiresAt <= now && record.status !== "expired") {
        document.results[key] = {
          ...record,
          status: "expired",
          updatedAt: new Date(now).toISOString(),
        };
      }
    }
  }

  async hasResult(params: { channel: ChannelId; botId: string; eventId: string }) {
    const document = await this.readDocument();
    return Boolean(document.results[buildResultKey(params)]);
  }

  async getResult(params: { channel: ChannelId; botId: string; eventId: string }) {
    const document = await this.readDocument();
    const key = buildResultKey(params);
    const record = document.results[key];
    if (!record) {
      return null;
    }
    if (record.status !== "expired" && isExpired(record)) {
      return await this.mutateDocument((nextDocument) => {
        const nextRecord = nextDocument.results[key];
        if (!nextRecord) {
          return null;
        }
        if (nextRecord.status === "expired" || !isExpired(nextRecord)) {
          return nextRecord;
        }
        const next = {
          ...nextRecord,
          status: "expired" as const,
          updatedAt: new Date().toISOString(),
        };
        nextDocument.results[key] = next;
        return next;
      });
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
    return await this.mutateDocument((document) => {
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
      document.results[buildResultKey(params)] = record;
      if (params.surfaceId || params.reply) {
        this.upsertSurfaceReplyInMemory(document, {
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
      return record;
    });
  }

  async updateStatus(params: {
    channel: ChannelId;
    botId: string;
    eventId: string;
    status: ChannelResultStatus;
    error?: ChannelResultError | null;
  }) {
    return await this.mutateDocument((document) => {
      const key = buildResultKey(params);
      const record = document.results[key];
      if (!record) {
        return null;
      }
      const next = {
        ...record,
        status: params.status,
        error: params.error === undefined ? record.error : params.error,
        updatedAt: new Date().toISOString(),
      };
      document.results[key] = next;
      return next;
    });
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
    return await this.mutateDocument((document) => {
      const key = buildResultKey(params);
      const record = document.results[key];
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
      document.results[key] = next;
      if (next.surfaceId) {
        this.upsertSurfaceReplyInMemory(document, {
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
      return next;
    });
  }

  async appendOutput(params: {
    channel: ChannelId;
    botId: string;
    eventId: string;
    kind: ChannelResultOutputKind;
    text: string;
    render?: ChannelResultRender;
  }) {
    return await this.mutateDocument((document) => {
      const key = buildResultKey(params);
      const record = document.results[key];
      if (!record) {
        return null;
      }
      const sequence = Math.max(
        0,
        ...record.progress.map((item) => item.sequence),
        record.result?.sequence ?? 0,
      ) + 1;
      const output: ChannelResultOutput = {
        sequence,
        kind: params.kind,
        text: truncateText(params.text),
        render: params.render ?? "text",
        createdAt: new Date().toISOString(),
      };
      const next: ChannelResultRecord = {
        ...record,
        progress: params.kind === "progress"
          ? sanitizeProgress([...record.progress, output])
          : record.progress,
        result: params.kind === "final" ? output : record.result,
        status: params.kind === "final"
          ? "completed"
          : record.status === "received"
            ? "processing"
            : record.status,
        updatedAt: output.createdAt,
      };
      document.results[key] = next;
      return next;
    });
  }

  async upsertSurfaceReply(params: Omit<ChannelSurfaceReplyRecord, "updatedAt">) {
    await this.mutateDocument((document) => {
      this.upsertSurfaceReplyInMemory(document, params);
    });
  }

  private upsertSurfaceReplyInMemory(
    document: StoreDocument,
    params: Omit<ChannelSurfaceReplyRecord, "updatedAt">,
  ) {
    document.surfaces[buildSurfaceResultKey(params)] = {
      ...params,
      updatedAt: new Date().toISOString(),
    };
  }

  async resolveSurfaceReply(params: { channel: ChannelId; botId: string; surfaceId: string }) {
    const document = await this.readDocument();
    return document.surfaces[buildSurfaceResultKey(params)] ?? null;
  }
}
