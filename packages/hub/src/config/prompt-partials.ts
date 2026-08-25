import { createHash } from "node:crypto";
import {
  MAX_PROMPT_PARTIAL_BUNDLE_BYTES,
  MAX_PROMPT_PARTIAL_CONTENT_BYTES,
  MAX_PROMPT_PARTIAL_COUNT,
  MAX_PROMPT_PARTIAL_PATH_LENGTH,
  PROMPT_PARTIAL_ROOT,
} from "./prompt-partial-limits.js";

export {
  MAX_PROMPT_PARTIAL_BUNDLE_BYTES,
  MAX_PROMPT_PARTIAL_CONTENT_BYTES,
  MAX_PROMPT_PARTIAL_COUNT,
  MAX_PROMPT_PARTIAL_PATH_LENGTH,
  PROMPT_PARTIAL_ROOT,
};

export interface ResolvedPromptPartial {
  path: string;
  content: string;
  contentHash: string;
}

export type ResolvedPromptPartials = ReadonlyMap<string, ResolvedPromptPartial>;

export interface PromptPartialBundleFile {
  path: string;
  content: string;
}

export interface PromptPartialBundleIssue {
  path: readonly (string | number)[];
  message: string;
}

export type PromptPartialReadResult =
  | { kind: "file"; content: string }
  | { kind: "directory" }
  | { kind: "symlink" }
  | { kind: "submodule" };

export class PromptPartialResolutionError extends Error {
  constructor(message: string) {
    super(`invalid prompt partial: ${message}`);
    this.name = "PromptPartialResolutionError";
  }
}

export class PromptPartialBundleError extends Error {
  constructor(readonly issues: readonly PromptPartialBundleIssue[]) {
    super("invalid prompt partial bundle");
    this.name = "PromptPartialBundleError";
  }
}

export function validatePromptPartialPath(value: string): string {
  const decoded = decodePromptPartialPath(value);
  if (decoded.length === 0) throw new PromptPartialResolutionError("path is empty");
  if (/^(?:[a-zA-Z]:[\\/]|[\\/]{1,2})/u.test(decoded)) {
    throw new PromptPartialResolutionError(`path must be relative to ${PROMPT_PARTIAL_ROOT}/`);
  }

  const segments = decoded.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new PromptPartialResolutionError(
      `path must not contain empty, '.' or '..' segments: ${value}`,
    );
  }
  const repositoryPath = `${PROMPT_PARTIAL_ROOT}/${segments.join("/")}`;
  if (!repositoryPath.startsWith(`${PROMPT_PARTIAL_ROOT}/`)) {
    throw new PromptPartialResolutionError(`path escapes ${PROMPT_PARTIAL_ROOT}/`);
  }
  return repositoryPath;
}

export function validateResolvedPromptPartialPath(value: string): string {
  const prefix = `${PROMPT_PARTIAL_ROOT}/`;
  if (!value.startsWith(prefix)) {
    throw new PromptPartialResolutionError(`resolved path is outside ${prefix}`);
  }
  const relative = value.slice(prefix.length);
  const validated = validatePromptPartialPath(relative);
  if (validated !== value) {
    throw new PromptPartialResolutionError(`resolved path is not canonical: ${value}`);
  }
  return validated;
}

/**
 * The `include:` form of a stored partial path — the inverse of
 * {@link validatePromptPartialPath}. Bundles and YAML name partials relative to
 * {@link PROMPT_PARTIAL_ROOT}; only stored paths carry the root.
 */
export function promptPartialIncludePath(repositoryPath: string): string {
  return validateResolvedPromptPartialPath(repositoryPath).slice(`${PROMPT_PARTIAL_ROOT}/`.length);
}

export function hashPromptPartialContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function collectPromptPartialPaths(configuration: unknown): readonly string[] {
  const paths = new Set<string>();
  if (!isRecord(configuration) || !Array.isArray(configuration["triggers"])) return [];
  for (const trigger of configuration["triggers"]) {
    if (!isRecord(trigger) || !Array.isArray(trigger["steps"])) continue;
    for (const step of trigger["steps"]) {
      if (!isRecord(step) || !Array.isArray(step["prompt"])) continue;
      for (const block of step["prompt"]) {
        if (!isRecord(block) || !Object.hasOwn(block, "include")) continue;
        if (typeof block["include"] !== "string") {
          throw new PromptPartialResolutionError("include path must be a string");
        }
        paths.add(validatePromptPartialPath(block["include"]));
      }
    }
  }
  return [...paths];
}

export async function resolvePromptPartials(input: {
  configuration: unknown;
  read(path: string): Promise<PromptPartialReadResult | undefined>;
}): Promise<ResolvedPromptPartials> {
  const resolved = new Map<string, ResolvedPromptPartial>();
  for (const path of collectPromptPartialPaths(input.configuration)) {
    const file = await input.read(path);
    if (file === undefined) {
      throw new PromptPartialResolutionError(`file does not exist at exact commit: ${path}`);
    }
    if (file.kind !== "file") {
      throw new PromptPartialResolutionError(`${path} is not a regular file (${file.kind})`);
    }
    resolved.set(path, {
      path,
      content: file.content,
      contentHash: hashPromptPartialContent(file.content),
    });
  }
  return resolved;
}

export async function resolvePromptPartialsFromBundle(input: {
  configuration: unknown;
  files: readonly PromptPartialBundleFile[];
}): Promise<ResolvedPromptPartials> {
  const normalizedFiles = new Map<string, { index: number; content: string }>();
  const issues: PromptPartialBundleIssue[] = [];
  let bundleBytes = 0;

  if (input.files.length > MAX_PROMPT_PARTIAL_COUNT) {
    issues.push({
      path: ["partials"],
      message: `bundle contains ${input.files.length} files; the limit is ${MAX_PROMPT_PARTIAL_COUNT}`,
    });
  }

  for (const [index, file] of input.files.entries()) {
    const contentBytes = Buffer.byteLength(file.content, "utf8");
    bundleBytes += contentBytes;
    if (contentBytes > MAX_PROMPT_PARTIAL_CONTENT_BYTES) {
      issues.push({
        path: ["partials", index, "content"],
        message: `content exceeds the ${MAX_PROMPT_PARTIAL_CONTENT_BYTES}-byte limit`,
      });
    }
    let path: string;
    try {
      path = validatePromptPartialPath(file.path);
    } catch (error) {
      issues.push({
        path: ["partials", index, "path"],
        message: error instanceof Error ? error.message : "path is unsafe",
      });
      continue;
    }
    if (path.length > MAX_PROMPT_PARTIAL_PATH_LENGTH) {
      issues.push({
        path: ["partials", index, "path"],
        message: `path exceeds the ${MAX_PROMPT_PARTIAL_PATH_LENGTH}-character limit`,
      });
      continue;
    }
    if (normalizedFiles.has(path)) {
      issues.push({
        path: ["partials", index, "path"],
        message: `duplicate partial path after normalization: ${path}`,
      });
      continue;
    }
    normalizedFiles.set(path, { index, content: file.content });
  }

  if (bundleBytes > MAX_PROMPT_PARTIAL_BUNDLE_BYTES) {
    issues.push({
      path: ["partials"],
      message: `combined content exceeds the ${MAX_PROMPT_PARTIAL_BUNDLE_BYTES}-byte limit`,
    });
  }

  let requestedPaths: readonly string[] = [];
  try {
    requestedPaths = collectPromptPartialPaths(input.configuration);
  } catch (error) {
    issues.push({
      path: ["yaml"],
      message: error instanceof Error ? error.message : "include path is invalid",
    });
  }

  const requested = new Set(requestedPaths);
  for (const path of [...requested].sort()) {
    if (!normalizedFiles.has(path)) {
      issues.push({
        path: ["partials", path],
        message: `partial file is required by the configuration but was not supplied: ${path}`,
      });
    }
  }
  for (const [path, file] of [...normalizedFiles.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!requested.has(path)) {
      issues.push({
        path: ["partials", file.index, "path"],
        message: `partial file is not referenced by the configuration: ${path}`,
      });
    }
  }

  if (issues.length > 0) throw new PromptPartialBundleError(issues);

  try {
    return await resolvePromptPartials({
      configuration: input.configuration,
      read: async (path) => {
        const file = normalizedFiles.get(path);
        return file === undefined ? undefined : { kind: "file", content: file.content };
      },
    });
  } catch (error) {
    if (error instanceof PromptPartialResolutionError) {
      throw new PromptPartialBundleError([{ path: ["partials"], message: error.message }]);
    }
    throw error;
  }
}

export function resolvedPromptPartialsEvidence(
  partials: ResolvedPromptPartials,
): readonly { path: string; content: string; contentHash: string }[] {
  return [...partials.values()]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path, content, contentHash }) => ({ path, content, contentHash }));
}

function decodePromptPartialPath(value: string): string {
  let decoded = value;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new PromptPartialResolutionError(`path contains invalid encoding: ${value}`);
    }
    if (next === decoded) break;
    decoded = next;
  }
  if (decoded.includes("\0")) {
    throw new PromptPartialResolutionError(`path contains a null byte: ${value}`);
  }
  if (/%[0-9a-f]{2}/iu.test(decoded)) {
    throw new PromptPartialResolutionError(`path contains encoded characters: ${value}`);
  }
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
