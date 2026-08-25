import { createHash } from "node:crypto";
import { load } from "js-yaml";
import { z } from "zod";
import {
  compileHubConfig,
  type CompiledAgent,
  type CompiledHubConfig,
  HubConfigurationCompilationError,
  type JsonValue,
} from "./compiler.js";
import {
  collectPromptPartialPaths,
  hashPromptPartialContent,
  type ResolvedPromptPartial,
  type ResolvedPromptPartials,
} from "./prompt-partials.js";
import {
  MAX_PROMPT_PARTIAL_BUNDLE_BYTES,
  MAX_PROMPT_PARTIAL_CONTENT_BYTES,
  MAX_PROMPT_PARTIAL_COUNT,
  MAX_PROMPT_PARTIAL_PATH_LENGTH,
} from "./prompt-partial-limits.js";
import { projectSlugSchema } from "../project-slug.js";
import {
  compareBundlePaths,
  HUB_RESOURCE_PATH,
  WORKFLOW_DIRECTORY,
  WORKFLOW_PARTIAL_DIRECTORY,
  type HubBundleFile,
} from "./bundle-contract.js";

export {
  HUB_RESOURCE_PATH,
  WORKFLOW_DIRECTORY,
  WORKFLOW_PARTIAL_DIRECTORY,
  type HubBundleFile,
} from "./bundle-contract.js";

export interface HubBundleIssue {
  path: readonly (string | number)[];
  message: string;
}

export interface CompiledHubBundle {
  name?: string;
  configuration: CompiledHubConfig;
  agentValidationTargets: readonly HubBundleAgentValidationTarget[];
  files: readonly HubBundleFile[];
  authoredHash: string;
}

export interface HubBundleAgentValidationTarget {
  name: string;
  agent: CompiledAgent;
  environmentNames: readonly string[];
}

export class HubBundleError extends Error {
  constructor(readonly issues: readonly HubBundleIssue[]) {
    super(issues.map((entry) => `${entry.path.join(".")}: ${entry.message}`).join("\n"));
    this.name = "HubBundleError";
  }
}

const JsonAgentSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    mode: z.string().min(1).optional(),
    thinkingOptionId: z.string().min(1).optional(),
    options: z.record(z.string(), z.custom<JsonValue>(isJsonValue)).optional(),
  })
  .strict();

export function compileHubBundle(input: readonly HubBundleFile[]): CompiledHubBundle {
  const files = normalizeBundleFiles(input);
  const resourceFile = files.get(HUB_RESOURCE_PATH);
  if (resourceFile === undefined) {
    throw issue([HUB_RESOURCE_PATH], `required resource file is missing`);
  }
  const resource = parseYamlRecord(resourceFile);
  if (Object.hasOwn(resource, "triggers")) {
    throw issue(
      [HUB_RESOURCE_PATH, "triggers"],
      "Monolithic triggers are not accepted; move each trigger to .paseo/workflows/<workflow>.yml.",
    );
  }
  rejectResourceKeys(resource);
  const bundleName = projectName(resource["name"]);
  const environments = namedResources(resource["environments"], "environment", HUB_RESOURCE_PATH);
  const agents = namedAgents(resource["agents"]);
  const workflowFiles = [...files.values()]
    .filter((file) => isWorkflowPath(file.path))
    .sort(byPath);
  if (workflowFiles.length === 0) {
    throw issue(
      [WORKFLOW_DIRECTORY],
      "at least one direct .paseo/workflows/<workflow>.yml document is required",
    );
  }
  const triggers: unknown[] = [];
  const workflowSourceFiles: string[] = [];
  const sourceFiles: Record<string, string> = {};
  for (const file of workflowFiles) {
    const trigger = parseYamlRecord(file);
    rejectWorkflowComposition(trigger, file.path);
    workflowSourceFiles.push(file.path);
    const name = trigger["name"];
    if (typeof name === "string") {
      const existing = sourceFiles[name];
      if (existing !== undefined) {
        throw issue([file.path, "name"], `workflow name ${name} is already defined in ${existing}`);
      }
      sourceFiles[name] = file.path;
    }
    triggers.push(trigger);
  }
  const rawConfiguration = { environments, triggers };
  const partials = resolvePartials(rawConfiguration, files);
  let configuration: CompiledHubConfig;
  try {
    configuration = compileHubConfig(rawConfiguration, {
      namedAgents: agents,
      sourceFiles,
      resolvedPromptPartials: partials,
    });
  } catch (error) {
    throw issue(
      sourcePathForError(error, sourceFiles, triggers, workflowSourceFiles, environments),
      errorMessage(error),
    );
  }
  const authoredFiles = [...files.values()].sort(byPath);
  return {
    ...(bundleName === undefined ? {} : { name: bundleName }),
    configuration,
    agentValidationTargets: collectAgentValidationTargets(triggers, configuration, agents),
    files: authoredFiles,
    authoredHash: hashAuthoredFiles(authoredFiles),
  };
}

function collectAgentValidationTargets(
  authoredTriggers: readonly unknown[],
  configuration: CompiledHubConfig,
  agentDefinitions: Readonly<Record<string, CompiledAgent>>,
): readonly HubBundleAgentValidationTarget[] {
  const allDaemonEnvironments = configuration.environments
    .filter((environment) => environment.kind === "daemon")
    .map(({ name }) => name);
  const targets = new Map<string, HubBundleAgentValidationTarget>();
  for (const [triggerIndex, authoredTrigger] of authoredTriggers.entries()) {
    const compiledTrigger = configuration.triggers[triggerIndex];
    if (!isRecord(authoredTrigger) || compiledTrigger === undefined) continue;
    const authoredSteps = Array.isArray(authoredTrigger["steps"]) ? authoredTrigger["steps"] : [];
    for (const [stepIndex, authoredStep] of authoredSteps.entries()) {
      const compiledStep = compiledTrigger.steps[stepIndex];
      if (!isRecord(authoredStep) || compiledStep === undefined) continue;
      const authoredAgent = authoredStep["agent"];
      if (typeof authoredAgent !== "string") continue;
      let names: readonly string[] = [];
      if (authoredAgent.includes("${{")) names = Object.keys(agentDefinitions);
      else if (Object.hasOwn(agentDefinitions, authoredAgent)) names = [authoredAgent];
      const authoredEnvironment = authoredStep["environment"];
      const environmentNames =
        typeof authoredEnvironment === "string" && !authoredEnvironment.includes("${{")
          ? [authoredEnvironment]
          : allDaemonEnvironments;
      for (const name of names) {
        const agent = agentDefinitions[name];
        if (agent === undefined) continue;
        const key = `${name}\0${environmentNames.join("\0")}`;
        targets.set(key, { name, agent, environmentNames });
      }
    }
  }
  return [...targets.values()];
}

function normalizeBundleFiles(input: readonly HubBundleFile[]): Map<string, HubBundleFile> {
  const files = new Map<string, HubBundleFile>();
  for (const [index, candidate] of input.entries()) {
    if (typeof candidate.path !== "string" || typeof candidate.content !== "string") {
      throw issue(["files", index], "bundle entries require string path and content");
    }
    validateBundlePath(candidate.path);
    if (files.has(candidate.path)) {
      throw issue([candidate.path], "duplicate/conflicting bundle entry");
    }
    files.set(candidate.path, { path: candidate.path, content: candidate.content });
  }
  return files;
}

function validateBundlePath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw issue([path], "unsafe bundle path");
  }
  if (path === ".paseo/hub.toml" || path.endsWith(".toml")) {
    throw issue([path], "TOML is not accepted; use .paseo/hub.yml and workflow .yml files");
  }
  if (path === HUB_RESOURCE_PATH) return;
  if (path.startsWith(`${WORKFLOW_PARTIAL_DIRECTORY}/`)) {
    if (!path.endsWith(".md")) {
      throw issue([path], "prompt partials must use the .md extension");
    }
    return;
  }
  if (path.startsWith(`${WORKFLOW_DIRECTORY}/`)) {
    const relative = path.slice(`${WORKFLOW_DIRECTORY}/`.length);
    if (relative.includes("/")) {
      throw issue([path], "workflow YAML must be a direct child of .paseo/workflows/");
    }
    if (relative.endsWith(".yaml")) {
      throw issue([path], "workflow files must use the .yml extension");
    }
    if (relative.endsWith(".yml")) return;
  }
  throw issue([path], "file is outside the canonical Hub bundle layout");
}

function parseYamlRecord(file: HubBundleFile): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = load(file.content);
  } catch (error) {
    throw issue([file.path], `invalid YAML: ${yamlLocation(error)}`);
  }
  if (!isRecord(parsed)) throw issue([file.path], "document must be a YAML mapping");
  return parsed;
}

function rejectResourceKeys(resource: Record<string, unknown>): void {
  for (const key of Object.keys(resource)) {
    if (key !== "name" && key !== "environments" && key !== "agents") {
      throw issue([HUB_RESOURCE_PATH, key], `unknown project resource ${key}`);
    }
  }
}

function projectName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const parsed = projectSlugSchema.safeParse(value);
  if (!parsed.success) {
    throw issue([HUB_RESOURCE_PATH, "name"], parsed.error.issues[0]?.message ?? "invalid slug");
  }
  return parsed.data;
}

function namedResources(value: unknown, kind: string, sourceFile: string): unknown[] {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw issue([sourceFile, `${kind}s`], `${kind}s must be a non-empty named map`);
  }
  return Object.entries(value)
    .sort(([left], [right]) => compareText(left, right))
    .map(([name, resource]) => {
      if (!isRecord(resource)) throw issue([sourceFile, `${kind}s`, name], `${kind} must be a map`);
      if (Object.hasOwn(resource, "name")) {
        throw issue(
          [sourceFile, `${kind}s`, name, "name"],
          `${kind} names are map keys and must not be repeated`,
        );
      }
      return Object.assign({ name }, resource);
    });
}

function namedAgents(value: unknown): Readonly<Record<string, CompiledAgent>> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw issue([HUB_RESOURCE_PATH, "agents"], "agents must be a named map");
  const agents: Record<string, CompiledAgent> = {};
  for (const [name, raw] of Object.entries(value).sort(([left], [right]) =>
    compareText(left, right),
  )) {
    if (!/^[a-z][a-z0-9_-]*$/u.test(name)) {
      throw issue([HUB_RESOURCE_PATH, "agents", name], "invalid agent name");
    }
    if (isRecord(raw) && Object.hasOwn(raw, "name")) {
      throw issue(
        [HUB_RESOURCE_PATH, "agents", name, "name"],
        "agent names are map keys and must not be repeated",
      );
    }
    const parsed = JsonAgentSchema.safeParse(raw);
    if (!parsed.success) {
      throw issue(
        [HUB_RESOURCE_PATH, "agents", name],
        parsed.error.issues.map(({ path, message }) => `${path.join(".")}: ${message}`).join("; "),
      );
    }
    agents[name] = parsed.data;
  }
  return agents;
}

function rejectWorkflowComposition(workflow: Record<string, unknown>, sourceFile: string): void {
  for (const field of ["uses", "workflow", "workflows", "call", "environment", "agent"]) {
    if (Object.hasOwn(workflow, field)) {
      throw issue(
        [sourceFile, field],
        `${field} is not part of a workflow file; keep one trigger and its inline steps together`,
      );
    }
  }
}

function resolvePartials(
  configuration: unknown,
  files: ReadonlyMap<string, HubBundleFile>,
): ResolvedPromptPartials {
  let requested: readonly string[];
  try {
    requested = collectPromptPartialPaths(configuration);
  } catch (error) {
    throw issue([WORKFLOW_DIRECTORY], errorMessage(error));
  }
  const resolved = new Map<string, ResolvedPromptPartial>();
  const supplied = [...files.values()].filter((file) =>
    file.path.startsWith(`${WORKFLOW_PARTIAL_DIRECTORY}/`),
  );
  if (supplied.length > MAX_PROMPT_PARTIAL_COUNT) {
    throw issue(
      [WORKFLOW_PARTIAL_DIRECTORY],
      `bundle contains ${supplied.length} partials; the limit is ${MAX_PROMPT_PARTIAL_COUNT}`,
    );
  }
  let totalBytes = 0;
  for (const file of supplied) {
    const bytes = Buffer.byteLength(file.content, "utf8");
    totalBytes += bytes;
    if (bytes > MAX_PROMPT_PARTIAL_CONTENT_BYTES) {
      throw issue(
        [file.path],
        `content exceeds the ${MAX_PROMPT_PARTIAL_CONTENT_BYTES}-byte limit`,
      );
    }
    if (file.path.length > MAX_PROMPT_PARTIAL_PATH_LENGTH) {
      throw issue(
        [file.path],
        `path exceeds the ${MAX_PROMPT_PARTIAL_PATH_LENGTH}-character limit`,
      );
    }
  }
  if (totalBytes > MAX_PROMPT_PARTIAL_BUNDLE_BYTES) {
    throw issue(
      [WORKFLOW_PARTIAL_DIRECTORY],
      `combined content exceeds the ${MAX_PROMPT_PARTIAL_BUNDLE_BYTES}-byte limit`,
    );
  }
  const requestedSet = new Set(requested);
  for (const file of supplied) {
    if (!requestedSet.has(file.path)) {
      throw issue([file.path], `partial file is not referenced by any workflow`);
    }
  }
  for (const path of requested.toSorted()) {
    if (!path.startsWith(`${WORKFLOW_PARTIAL_DIRECTORY}/`)) {
      throw issue([path], "prompt includes must resolve under .paseo/workflows/partials/");
    }
    const file = files.get(path);
    if (file === undefined) throw issue([path], "prompt partial is missing from the bundle");
    resolved.set(path, {
      path,
      content: file.content,
      contentHash: hashPromptPartialContent(file.content),
    });
  }
  return resolved;
}

function isWorkflowPath(path: string): boolean {
  return (
    path.startsWith(`${WORKFLOW_DIRECTORY}/`) &&
    !path.startsWith(`${WORKFLOW_PARTIAL_DIRECTORY}/`) &&
    path.endsWith(".yml")
  );
}

function sourcePathForError(
  error: unknown,
  sourceFiles: Readonly<Record<string, string>>,
  triggers: readonly unknown[],
  workflowSourceFiles: readonly string[],
  environments: readonly unknown[],
): readonly (string | number)[] {
  if (error instanceof HubConfigurationCompilationError) {
    return conceptualAuthoredPath(error.path, sourceFiles);
  }
  const zodIssue = firstZodIssue(error);
  if (zodIssue !== undefined) {
    const authored = zodAuthoredPath(
      zodIssue.path,
      sourceFiles,
      triggers,
      workflowSourceFiles,
      environments,
    );
    if (authored !== undefined) return authored;
  }
  return [HUB_RESOURCE_PATH];
}

function conceptualAuthoredPath(
  path: readonly (string | number)[],
  sourceFiles: Readonly<Record<string, string>>,
): readonly (string | number)[] {
  if (path[0] === "triggers" && typeof path[1] === "string") {
    const source = sourceFiles[path[1]];
    if (source !== undefined) return [source, ...path.slice(2)];
  }
  return [HUB_RESOURCE_PATH, ...path];
}

function zodAuthoredPath(
  path: readonly PropertyKey[],
  sourceFiles: Readonly<Record<string, string>>,
  triggers: readonly unknown[],
  workflowSourceFiles: readonly string[],
  environments: readonly unknown[],
): readonly (string | number)[] | undefined {
  const normalized = path.filter(
    (part): part is string | number => typeof part === "string" || typeof part === "number",
  );
  if (normalized[0] === "triggers" && typeof normalized[1] === "number") {
    const trigger = triggers[normalized[1]];
    const triggerRecord = isRecord(trigger) ? trigger : undefined;
    const source = workflowSourceFiles[normalized[1]];
    if (source === undefined) return undefined;
    const sourcePath: (string | number)[] = [source];
    const remainder = normalized.slice(2);
    for (let index = 0; index < remainder.length; index += 1) {
      const part = remainder[index];
      const next = remainder[index + 1];
      if (part === "steps" && typeof next === "number") {
        const steps = Array.isArray(triggerRecord?.["steps"]) ? triggerRecord["steps"] : [];
        const step: unknown = steps[next];
        sourcePath.push(
          "steps",
          isRecord(step) && typeof step["id"] === "string" ? step["id"] : next,
        );
        index += 1;
      } else if (typeof part === "string" || typeof part === "number") {
        sourcePath.push(part);
      }
    }
    return sourcePath;
  }
  if (normalized[0] === "environments" && typeof normalized[1] === "number") {
    const environment = environments[normalized[1]];
    const name = isRecord(environment) ? environment["name"] : undefined;
    return [
      HUB_RESOURCE_PATH,
      "environments",
      typeof name === "string" ? name : normalized[1],
      ...normalized.slice(2),
    ];
  }
  return undefined;
}

function firstZodIssue(
  error: unknown,
): { path: readonly PropertyKey[]; message: string } | undefined {
  if (!isRecord(error) || !Array.isArray(error["issues"])) return undefined;
  const candidate: unknown = error["issues"][0];
  if (!isRecord(candidate) || !Array.isArray(candidate["path"])) return undefined;
  return {
    path: candidate["path"],
    message: typeof candidate["message"] === "string" ? candidate["message"] : "invalid value",
  };
}

function hashAuthoredFiles(files: readonly HubBundleFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(JSON.stringify(file.path));
    hash.update("\0");
    hash.update(file.content, "utf8");
    hash.update("\0");
  }
  return hash.digest("hex");
}

function yamlLocation(error: unknown): string {
  const mark = isRecord(error) && isRecord(error["mark"]) ? error["mark"] : undefined;
  return typeof mark?.["line"] === "number" && typeof mark["column"] === "number"
    ? `line ${mark["line"] + 1}, column ${mark["column"] + 1}`
    : errorMessage(error);
}

function issue(path: readonly (string | number)[], message: string): HubBundleError {
  return new HubBundleError([{ path, message }]);
}

function byPath(left: HubBundleFile, right: HubBundleFile): number {
  return compareBundlePaths(left, right);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function errorMessage(error: unknown): string {
  const zodIssue = firstZodIssue(error);
  if (zodIssue !== undefined) return zodIssue.message;
  return error instanceof Error ? error.message : "invalid Hub configuration bundle";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
