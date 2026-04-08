import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import { DEFAULT_PAIRING_DIR, ensureDir } from "../../shared/paths.ts";

export type PairingChannel = "slack" | "telegram";

export type PairingRequest = {
  id: string;
  code: string;
  createdAt: string;
  lastSeenAt: string;
  meta?: Record<string, string>;
};

type PairingStore = {
  version: 1;
  requests: PairingRequest[];
};

type AllowFromStore = {
  version: 1;
  allowFrom: string[];
};

const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_PENDING_TTL_MS = 60 * 60 * 1000;
const PAIRING_PENDING_MAX = 3;
const PAIRING_STORE_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 50,
    maxTimeout: 2_000,
    randomize: true,
  },
  stale: 30_000,
} as const;

function resolvePairingPath(channel: PairingChannel, baseDir = DEFAULT_PAIRING_DIR) {
  return path.join(baseDir, `${channel}-pairing.json`);
}

function resolveAllowFromPath(channel: PairingChannel, baseDir = DEFAULT_PAIRING_DIR) {
  return path.join(baseDir, `${channel}-allowFrom.json`);
}

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<{ value: T; exists: boolean }> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const parsed = safeParseJson<T>(raw);
    if (parsed == null) {
      return { value: fallback, exists: true };
    }
    return { value: parsed, exists: true };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") {
      return { value: fallback, exists: false };
    }
    return { value: fallback, exists: false };
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await ensureDir(path.dirname(filePath));
  const tmpPath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath)}.${crypto.randomUUID()}.tmp`,
  );
  await fs.promises.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.promises.rename(tmpPath, filePath);
}

async function ensureJsonFile(filePath: string, fallback: unknown) {
  try {
    await fs.promises.access(filePath);
  } catch {
    await writeJsonFile(filePath, fallback);
  }
}

async function withFileLock<T>(filePath: string, fallback: unknown, fn: () => Promise<T>): Promise<T> {
  await ensureJsonFile(filePath, fallback);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(filePath, PAIRING_STORE_LOCK_OPTIONS);
    return await fn();
  } finally {
    if (release) {
      try {
        await release();
      } catch {
        // Ignore unlock failures.
      }
    }
  }
}

function parseTimestamp(value: string | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function isExpired(request: PairingRequest, nowMs: number) {
  const createdAt = parseTimestamp(request.createdAt);
  if (!createdAt) {
    return true;
  }
  return nowMs - createdAt > PAIRING_PENDING_TTL_MS;
}

function pruneExpiredRequests(requests: PairingRequest[], nowMs: number) {
  const kept: PairingRequest[] = [];
  let removed = false;
  for (const request of requests) {
    if (isExpired(request, nowMs)) {
      removed = true;
      continue;
    }
    kept.push(request);
  }
  return { requests: kept, removed };
}

function resolveLastSeenAt(request: PairingRequest) {
  return parseTimestamp(request.lastSeenAt) ?? parseTimestamp(request.createdAt) ?? 0;
}

function pruneExcessRequests(requests: PairingRequest[], maxPending: number) {
  if (maxPending <= 0 || requests.length <= maxPending) {
    return { requests, removed: false };
  }

  const sorted = requests
    .slice()
    .sort((left, right) => resolveLastSeenAt(left) - resolveLastSeenAt(right));
  return {
    requests: sorted.slice(-maxPending),
    removed: true,
  };
}

function normalizeId(value: string | number) {
  return String(value).trim();
}

function randomCode() {
  let code = "";
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    code += PAIRING_CODE_ALPHABET[crypto.randomInt(0, PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

function generateUniqueCode(existingCodes: Set<string>) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const code = randomCode();
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  throw new Error("failed to generate unique pairing code");
}

export async function listChannelPairingRequests(
  channel: PairingChannel,
  baseDir = DEFAULT_PAIRING_DIR,
) {
  const filePath = resolvePairingPath(channel, baseDir);
  return withFileLock(filePath, { version: 1, requests: [] } satisfies PairingStore, async () => {
    const { value } = await readJsonFile<PairingStore>(filePath, {
      version: 1,
      requests: [],
    });
    const requests = Array.isArray(value.requests) ? value.requests : [];
    const nowMs = Date.now();
    const { requests: prunedExpired, removed: expiredRemoved } = pruneExpiredRequests(
      requests,
      nowMs,
    );
    const { requests: pruned, removed: cappedRemoved } = pruneExcessRequests(
      prunedExpired,
      PAIRING_PENDING_MAX,
    );
    if (expiredRemoved || cappedRemoved) {
      await writeJsonFile(filePath, {
        version: 1,
        requests: pruned,
      } satisfies PairingStore);
    }
    return pruned
      .filter(
        (request) =>
          request &&
          typeof request.id === "string" &&
          typeof request.code === "string" &&
          typeof request.createdAt === "string",
      )
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  });
}

export async function readChannelAllowFromStore(
  channel: PairingChannel,
  baseDir = DEFAULT_PAIRING_DIR,
) {
  const filePath = resolveAllowFromPath(channel, baseDir);
  const { value } = await readJsonFile<AllowFromStore>(filePath, {
    version: 1,
    allowFrom: [],
  });
  return Array.isArray(value.allowFrom)
    ? value.allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
    : [];
}

export async function addChannelAllowFromStoreEntry(params: {
  channel: PairingChannel;
  entry: string | number;
  baseDir?: string;
}) {
  const filePath = resolveAllowFromPath(params.channel, params.baseDir);
  return withFileLock(
    filePath,
    { version: 1, allowFrom: [] } satisfies AllowFromStore,
    async () => {
      const { value } = await readJsonFile<AllowFromStore>(filePath, {
        version: 1,
        allowFrom: [],
      });
      const current = Array.isArray(value.allowFrom)
        ? value.allowFrom.map((entry) => String(entry).trim()).filter(Boolean)
        : [];
      const normalized = normalizeId(params.entry);
      if (!normalized) {
        return { changed: false, allowFrom: current };
      }
      if (current.includes(normalized)) {
        return { changed: false, allowFrom: current };
      }
      const next = [...current, normalized];
      await writeJsonFile(filePath, {
        version: 1,
        allowFrom: next,
      } satisfies AllowFromStore);
      return { changed: true, allowFrom: next };
    },
  );
}

export async function upsertChannelPairingRequest(params: {
  channel: PairingChannel;
  id: string | number;
  meta?: Record<string, string | undefined | null>;
  baseDir?: string;
}) {
  const filePath = resolvePairingPath(params.channel, params.baseDir);
  return withFileLock(
    filePath,
    { version: 1, requests: [] } satisfies PairingStore,
    async () => {
      const { value } = await readJsonFile<PairingStore>(filePath, {
        version: 1,
        requests: [],
      });
      const now = new Date().toISOString();
      const nowMs = Date.now();
      const id = normalizeId(params.id);
      const meta =
        params.meta && typeof params.meta === "object"
          ? Object.fromEntries(
              Object.entries(params.meta)
                .map(([key, entry]) => [key, String(entry ?? "").trim()] as const)
                .filter(([_, entry]) => Boolean(entry)),
            )
          : undefined;

      let requests = Array.isArray(value.requests) ? value.requests : [];
      const { requests: prunedExpired } = pruneExpiredRequests(requests, nowMs);
      requests = prunedExpired;
      const existingIndex = requests.findIndex((request) => request.id === id);
      const existingCodes = new Set(
        requests.map((request) => String(request.code ?? "").trim().toUpperCase()),
      );

      if (existingIndex >= 0) {
        const existing = requests[existingIndex];
        const code =
          existing && typeof existing.code === "string" && existing.code.trim()
            ? existing.code.trim()
            : generateUniqueCode(existingCodes);
        requests[existingIndex] = {
          id,
          code,
          createdAt: existing?.createdAt ?? now,
          lastSeenAt: now,
          meta: meta ?? existing?.meta,
        };
        const { requests: capped } = pruneExcessRequests(requests, PAIRING_PENDING_MAX);
        await writeJsonFile(filePath, {
          version: 1,
          requests: capped,
        } satisfies PairingStore);
        return { code, created: false };
      }

      const { requests: capped } = pruneExcessRequests(requests, PAIRING_PENDING_MAX);
      requests = capped;
      if (PAIRING_PENDING_MAX > 0 && requests.length >= PAIRING_PENDING_MAX) {
        await writeJsonFile(filePath, {
          version: 1,
          requests,
        } satisfies PairingStore);
        return { code: "", created: false };
      }

      const code = generateUniqueCode(existingCodes);
      await writeJsonFile(filePath, {
        version: 1,
        requests: [
          ...requests,
          {
            id,
            code,
            createdAt: now,
            lastSeenAt: now,
            ...(meta ? { meta } : {}),
          },
        ],
      } satisfies PairingStore);
      return { code, created: true };
    },
  );
}

export async function approveChannelPairingCode(params: {
  channel: PairingChannel;
  code: string;
  baseDir?: string;
}) {
  const code = params.code.trim().toUpperCase();
  if (!code) {
    return null;
  }

  const filePath = resolvePairingPath(params.channel, params.baseDir);
  return withFileLock(
    filePath,
    { version: 1, requests: [] } satisfies PairingStore,
    async () => {
      const { value } = await readJsonFile<PairingStore>(filePath, {
        version: 1,
        requests: [],
      });
      const requests = Array.isArray(value.requests) ? value.requests : [];
      const { requests: pruned, removed } = pruneExpiredRequests(requests, Date.now());
      const matchIndex = pruned.findIndex(
        (request) => String(request.code ?? "").trim().toUpperCase() === code,
      );
      if (matchIndex < 0) {
        if (removed) {
          await writeJsonFile(filePath, {
            version: 1,
            requests: pruned,
          } satisfies PairingStore);
        }
        return null;
      }

      const entry = pruned[matchIndex];
      if (!entry) {
        return null;
      }

      pruned.splice(matchIndex, 1);
      await writeJsonFile(filePath, {
        version: 1,
        requests: pruned,
      } satisfies PairingStore);
      await addChannelAllowFromStoreEntry({
        channel: params.channel,
        entry: entry.id,
        baseDir: params.baseDir,
      });
      return { id: entry.id, entry };
    },
  );
}
