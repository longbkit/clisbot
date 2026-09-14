import { randomUUID } from "node:crypto";

export interface DownloadTokenEntry {
  token: string;
  path: string;
  absolutePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  expiresAt: number;
}

interface DownloadTokenStoreOptions {
  ttlMs: number;
  now?: () => number;
  maxTokens?: number;
  maxBytes?: number;
}

export const DOWNLOAD_TOKEN_LIMITS = { count: 1024, bytes: 8 * 1024 * 1024 };
function tokenBytes(
  entry: Pick<DownloadTokenEntry, "path" | "absolutePath" | "fileName" | "mimeType">,
): number {
  return (
    256 +
    2 *
      (entry.path.length +
        entry.absolutePath.length +
        entry.fileName.length +
        entry.mimeType.length)
  );
}

export class DownloadTokenStore {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly tokens = new Map<string, DownloadTokenEntry>();
  private readonly maxTokens: number;
  private readonly maxBytes: number;
  private retainedBytes = 0;

  constructor(options: DownloadTokenStoreOptions) {
    this.ttlMs = options.ttlMs;
    this.now = options.now ?? (() => Date.now());
    this.maxTokens = options.maxTokens ?? DOWNLOAD_TOKEN_LIMITS.count;
    this.maxBytes = options.maxBytes ?? DOWNLOAD_TOKEN_LIMITS.bytes;
    if (
      !Number.isSafeInteger(this.maxTokens) ||
      this.maxTokens < 1 ||
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes < 1
    )
      throw new Error("Invalid download token budget");
  }

  issueToken(input: Omit<DownloadTokenEntry, "token" | "expiresAt">): DownloadTokenEntry {
    this.pruneExpired();
    const bytes = tokenBytes(input);
    if (this.tokens.size >= this.maxTokens || this.retainedBytes + bytes > this.maxBytes)
      throw new Error("Download token storage overloaded: admission budget exceeded");
    const token = randomUUID();
    const expiresAt = this.now() + this.ttlMs;
    const entry: DownloadTokenEntry = {
      ...input,
      token,
      expiresAt,
    };
    this.tokens.set(token, entry);
    this.retainedBytes += bytes;
    return { ...entry };
  }

  consumeToken(token: string): DownloadTokenEntry | null {
    const entry = this.tokens.get(token);
    if (!entry) {
      return null;
    }

    this.tokens.delete(token);
    this.retainedBytes -= tokenBytes(entry);

    if (entry.expiresAt <= this.now()) {
      return null;
    }

    return entry;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [token, entry] of this.tokens) {
      if (entry.expiresAt <= now) {
        this.tokens.delete(token);
        this.retainedBytes -= tokenBytes(entry);
      }
    }
  }
}
