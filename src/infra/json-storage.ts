import { randomUUID } from "node:crypto";
import { chmod, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { ensureDir } from "./fs.ts";

export type JsonDocument = Record<string, unknown> | unknown[];

export type JsonFileLockOptions = {
  retries?:
    | number
    | {
        retries?: number;
        factor?: number;
        minTimeout?: number;
        maxTimeout?: number;
        randomize?: boolean;
      };
  stale?: number;
};

export type JsonFileStorageOptions<TDocument extends object> = {
  fallback: TDocument | (() => TDocument);
  normalize?: (value: unknown) => TDocument;
  mode?: number;
  lock?: JsonFileLockOptions;
};

const DEFAULT_JSON_FILE_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 50,
    maxTimeout: 2_000,
    randomize: true,
  },
  stale: 30_000,
} as const;

function cloneFallback<TDocument extends object>(fallback: TDocument | (() => TDocument)) {
  const value = typeof fallback === "function" ? (fallback as () => TDocument)() : fallback;
  return structuredClone(value);
}

function normalizeDocument<TDocument extends object>(
  value: unknown,
  options: JsonFileStorageOptions<TDocument>,
) {
  if (options.normalize) {
    return options.normalize(value);
  }
  if (value && typeof value === "object") {
    return value as TDocument;
  }
  return cloneFallback(options.fallback);
}

async function readJsonDocument<TDocument extends object>(
  filePath: string,
  options: JsonFileStorageOptions<TDocument>,
) {
  try {
    const raw = await readFile(filePath, "utf8");
    if (!raw.trim()) {
      return cloneFallback(options.fallback);
    }
    return normalizeDocument(JSON.parse(raw), options);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") {
      return cloneFallback(options.fallback);
    }
    if (error instanceof SyntaxError) {
      return cloneFallback(options.fallback);
    }
    throw error;
  }
}

async function writeJsonDocument<TDocument extends object>(
  filePath: string,
  document: TDocument,
  options: JsonFileStorageOptions<TDocument>,
) {
  await ensureDir(dirname(filePath));
  const tempPath = join(
    dirname(filePath),
    `${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      mode: options.mode,
    });
    if (options.mode !== undefined) {
      await chmod(tempPath, options.mode);
    }
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function ensureLockFile(lockPath: string) {
  await ensureDir(dirname(lockPath));
  const handle = await open(lockPath, "a");
  await handle.close();
}

async function withJsonFileLock<TDocument extends object, TResult>(
  filePath: string,
  options: JsonFileStorageOptions<TDocument>,
  work: () => Promise<TResult>,
) {
  const lockPath = `${filePath}.lock`;
  await ensureLockFile(lockPath);
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(lockPath, options.lock ?? DEFAULT_JSON_FILE_LOCK_OPTIONS);
    return await work();
  } finally {
    if (release) {
      await release().catch(() => {});
    }
  }
}

export async function readJsonFile<TDocument extends object>(
  filePath: string,
  options: JsonFileStorageOptions<TDocument>,
) {
  return await readJsonDocument(filePath, options);
}

export async function writeJsonFile<TDocument extends object>(
  filePath: string,
  document: TDocument,
  options: JsonFileStorageOptions<TDocument>,
) {
  await withJsonFileLock<TDocument, void>(filePath, options, async () => {
    await writeJsonDocument(filePath, document, options);
  });
}

export async function withJsonFileMutation<TDocument extends object, TResult>(
  filePath: string,
  options: JsonFileStorageOptions<TDocument>,
  mutator: (document: TDocument) => TResult | Promise<TResult>,
) {
  return await withJsonFileLock<TDocument, TResult>(filePath, options, async () => {
    const document = await readJsonDocument(filePath, options);
    const result = await mutator(document);
    await writeJsonDocument(filePath, document, options);
    return result;
  });
}
