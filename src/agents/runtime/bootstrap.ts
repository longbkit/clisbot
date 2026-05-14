import { fileURLToPath } from "node:url";
import { cpSync, existsSync, lstatSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensureDir } from "../../infra/paths.ts";
import type {
  AgentBootstrapMode,
  AgentCliToolId,
} from "../../config/runtime/agent-tool-presets.ts";

export function resolveTemplateRoot(moduleDir: string) {
  const candidates = [
    join(moduleDir, "..", "..", "..", "templates"),
    join(moduleDir, "..", "..", "templates"),
    join(moduleDir, "..", "templates"),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "default")) && existsSync(join(candidate, "customized"))) {
      return candidate;
    }
  }

  return candidates[0];
}

const TEMPLATE_ROOT = resolveTemplateRoot(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_TEMPLATE_DIR = join(TEMPLATE_ROOT, "default");
const CUSTOMIZED_TEMPLATE_DIR = join(TEMPLATE_ROOT, "customized");
const CUSTOMIZED_DEFAULT_TEMPLATE_DIR = join(CUSTOMIZED_TEMPLATE_DIR, "default");

const CANONICAL_BOOTSTRAP_FILE = "AGENTS.md";
const TOOL_DISCOVERY_FILE: Partial<Record<AgentCliToolId, string>> = {
  claude: "CLAUDE.md",
  gemini: "GEMINI.md",
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

function pathExists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function shouldIncludeTemplateFile(relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.endsWith("CLAUDE.md")) {
    return false;
  }

  if (normalized.endsWith("GEMINI.md")) {
    return false;
  }

  return true;
}

function collectTemplateFiles(rootDir: string, prefix = ""): TemplateFile[] {
  const files: TemplateFile[] = [];

  for (const entry of readdirSync(rootDir)) {
    const sourcePath = join(rootDir, entry);
    const relativePath = prefix ? join(prefix, entry) : entry;
    const sourceStat = statSync(sourcePath);

    if (sourceStat.isDirectory()) {
      files.push(...collectTemplateFiles(sourcePath, relativePath));
      continue;
    }

    if (!shouldIncludeTemplateFile(relativePath)) {
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
    ...collectTemplateFiles(DEFAULT_TEMPLATE_DIR),
    ...collectTemplateFiles(CUSTOMIZED_DEFAULT_TEMPLATE_DIR).map((file) => ({
      ...file,
      customized: true,
    })),
    ...collectTemplateFiles(join(CUSTOMIZED_TEMPLATE_DIR, mode)).map((file) => ({
      ...file,
      customized: true,
    })),
  ];
}

function getBootstrapManagedPaths(toolId: AgentCliToolId, mode: AgentBootstrapMode) {
  const paths = new Set(getTemplateFiles(toolId, mode).map((file) => file.relativePath));
  const discoveryFile = TOOL_DISCOVERY_FILE[toolId];
  if (discoveryFile) {
    paths.add(discoveryFile);
  }
  return [...paths];
}

export function getBootstrapTemplateConflicts(
  workspacePath: string,
  toolId: AgentCliToolId,
  mode: AgentBootstrapMode,
) {
  if (!existsSync(workspacePath)) {
    return [];
  }

  return getBootstrapManagedPaths(toolId, mode)
    .filter((relativePath) => pathExists(join(workspacePath, relativePath)));
}

function writeToolDiscoverySymlink(
  workspacePath: string,
  toolId: AgentCliToolId,
  options?: {
    force?: boolean;
  },
) {
  const discoveryFile = TOOL_DISCOVERY_FILE[toolId];
  if (!discoveryFile) {
    return;
  }

  const destinationPath = join(workspacePath, discoveryFile);
  if (options?.force) {
    rmSync(destinationPath, {
      force: true,
      recursive: false,
    });
  }

  symlinkSync(CANONICAL_BOOTSTRAP_FILE, destinationPath);
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
  writeToolDiscoverySymlink(workspacePath, toolId, {
    force,
  });
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
    !existsSync(join(workspacePath, CANONICAL_BOOTSTRAP_FILE)) ||
    !existsSync(join(workspacePath, "IDENTITY.md"))
  ) {
    return "missing";
  }

  const discoveryFile = TOOL_DISCOVERY_FILE[toolId];
  if (discoveryFile && !existsSync(join(workspacePath, discoveryFile))) {
    return "missing";
  }

  if (existsSync(join(workspacePath, "BOOTSTRAP.md"))) {
    return "not-bootstrapped";
  }

  return "bootstrapped";
}
