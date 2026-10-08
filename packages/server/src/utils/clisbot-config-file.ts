import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ClisbotConfigRawSchema,
  type ClisbotConfigRaw,
  type ClisbotConfigRevision,
  type ProjectConfigRpcError,
} from "@clisbot/protocol/clisbot-config-schema";
export {
  ClisbotConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type ClisbotConfigRevision,
  type ProjectConfigRpcError,
} from "@clisbot/protocol/clisbot-config-schema";

export const CLISBOT_CONFIG_FILE_NAME = "clisbot.json";

export type ReadClisbotConfigForEditResult =
  | { ok: true; config: ClisbotConfigRaw | null; revision: ClisbotConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WriteClisbotConfigForEditResult =
  | { ok: true; config: ClisbotConfigRaw; revision: ClisbotConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WriteClisbotConfigForEditInput {
  repoRoot: string;
  config: ClisbotConfigRaw;
  expectedRevision: ClisbotConfigRevision | null;
}

export function resolveClisbotConfigPath(repoRoot: string): string {
  return join(repoRoot, CLISBOT_CONFIG_FILE_NAME);
}

export function statClisbotConfigPath(repoRoot: string): ClisbotConfigRevision | null {
  const configPath = resolveClisbotConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function readClisbotConfigJson(repoRoot: string): unknown {
  const configPath = resolveClisbotConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readClisbotConfigForEdit(repoRoot: string): ReadClisbotConfigForEditResult {
  try {
    const json = readClisbotConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: ClisbotConfigRawSchema.parse(json),
      revision: statClisbotConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writeClisbotConfigForEdit(
  input: WriteClisbotConfigForEditInput,
): WriteClisbotConfigForEditResult {
  const parsed = ClisbotConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolveClisbotConfigPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${CLISBOT_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statClisbotConfigPath(input.repoRoot);
    if (!clisbotConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempClisbotConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statClisbotConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempClisbotConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function clisbotConfigRevisionsEqual(
  left: ClisbotConfigRevision | null,
  right: ClisbotConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTempClisbotConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
