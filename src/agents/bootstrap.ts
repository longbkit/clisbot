import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ensureDir } from "../shared/paths.ts";
import type {
  AgentBootstrapMode,
  AgentCliToolId,
} from "../config/agent-tool-presets.ts";

const TEMPLATE_ROOT = join(import.meta.dir, "..", "..", "templates");
const OPENCLAW_TEMPLATE_DIR = join(TEMPLATE_ROOT, "openclaw");
const CUSTOMIZED_TEMPLATE_DIR = join(TEMPLATE_ROOT, "customized");

const TOOL_BOOTSTRAP_FILE: Record<AgentCliToolId, string> = {
  codex: "AGENTS.md",
  claude: "CLAUDE.md",
};

export type BootstrapWorkspaceState =
  | "not-configured"
  | "missing"
  | "not-bootstrapped"
  | "bootstrapped";

type TemplateFile = {
  sourcePath: string;
  relativePath: string;
  customized: boolean;
};

function shouldIncludeTemplateFile(toolId: AgentCliToolId, relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.endsWith("AGENTS.md")) {
    return toolId === "codex";
  }

  if (normalized.endsWith("CLAUDE.md")) {
    return toolId === "claude";
  }

  return true;
}

function collectTemplateFiles(rootDir: string, toolId: AgentCliToolId, prefix = ""): TemplateFile[] {
  const files: TemplateFile[] = [];

  for (const entry of readdirSync(rootDir)) {
    const sourcePath = join(rootDir, entry);
    const relativePath = prefix ? join(prefix, entry) : entry;
    const sourceStat = statSync(sourcePath);

    if (sourceStat.isDirectory()) {
      files.push(...collectTemplateFiles(sourcePath, toolId, relativePath));
      continue;
    }

    if (!shouldIncludeTemplateFile(toolId, relativePath)) {
      continue;
    }

    files.push({
      sourcePath,
      relativePath,
      customized: false,
    });
  }

  return files;
}

function getTemplateFiles(toolId: AgentCliToolId, mode: AgentBootstrapMode) {
  return [
    ...collectTemplateFiles(OPENCLAW_TEMPLATE_DIR, toolId),
    ...collectTemplateFiles(join(CUSTOMIZED_TEMPLATE_DIR, mode), toolId).map((file) => ({
      ...file,
      customized: true,
    })),
  ];
}

export function getBootstrapTemplateConflicts(
  workspacePath: string,
  toolId: AgentCliToolId,
  mode: AgentBootstrapMode,
) {
  if (!existsSync(workspacePath)) {
    return [];
  }

  return getTemplateFiles(toolId, mode)
    .map((file) => file.relativePath)
    .filter((relativePath) => existsSync(join(workspacePath, relativePath)));
}

export async function applyBootstrapTemplate(
  workspacePath: string,
  mode: AgentBootstrapMode,
  toolId: AgentCliToolId,
  options?: {
    force?: boolean;
  },
) {
  const force = options?.force === true;
  const conflicts = getBootstrapTemplateConflicts(workspacePath, toolId, mode);
  if (conflicts.length > 0 && !force) {
    throw new Error(
      `Bootstrap files already exist for ${toolId}/${mode}: ${conflicts.join(", ")}. Run again with --force to overwrite.`,
    );
  }

  await ensureDir(workspacePath);
  for (const file of getTemplateFiles(toolId, mode)) {
    cpSync(file.sourcePath, join(workspacePath, file.relativePath), {
      recursive: false,
      errorOnExist: false,
      force: force || file.customized,
    });
  }
}

export function getBootstrapWorkspaceState(
  workspacePath: string,
  mode?: AgentBootstrapMode,
  toolId?: AgentCliToolId,
): BootstrapWorkspaceState {
  if (!mode) {
    return "not-configured";
  }

  if (!toolId || !existsSync(workspacePath)) {
    return "missing";
  }

  if (
    !existsSync(join(workspacePath, TOOL_BOOTSTRAP_FILE[toolId])) ||
    !existsSync(join(workspacePath, "IDENTITY.md"))
  ) {
    return "missing";
  }

  if (existsSync(join(workspacePath, "BOOTSTRAP.md"))) {
    return "not-bootstrapped";
  }

  return "bootstrapped";
}
