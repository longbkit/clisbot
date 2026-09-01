import { parseDocument, stringify, type Document } from "yaml";
import { z } from "zod";
import { TriggerDocumentSchema, type TriggerDocument } from "./schema.js";

export const EDITOR_EVENTS = [
  "slack.mention",
  "discord.mention",
  "github.issue_comment",
  "linear.issue_created",
  "manual.run",
] as const;

export type EditorEvent = (typeof EDITOR_EVENTS)[number];

export function parseEditorEvent(value: string): EditorEvent {
  return isEditorEvent(value) ? value : "manual.run";
}

export interface TriggerFormValue {
  name: string;
  enabled: boolean;
  event: EditorEvent;
  connection: string;
  allowedUsers: string;
  daemon: string;
  cwd: string;
  agent: string;
  mode: string;
  thinkingOptionId: string;
  providerOptions: string;
  maxRuntime: string;
  idleTimeout: string;
  githubConnection: string;
  githubRepositories: string;
  githubPermissions: string;
  githubDuration: string;
  prompt: string;
}

export type TriggerFormProjection =
  | { status: "editable"; value: TriggerFormValue }
  | { status: "yaml_only"; reason: string };

const ProviderOptionsSchema = z.record(z.string(), z.unknown());
const GitHubPermissionsSchema = z.record(z.string(), z.enum(["read", "write", "admin"]));

export function projectTriggerForm(yaml: string): TriggerFormProjection {
  const parsed = parseEditorDocument(yaml);
  if (!parsed.success) return { status: "yaml_only", reason: parsed.error };
  const trigger = parsed.data;
  const events = Object.entries(trigger.on);
  if (events.length !== 1) {
    return { status: "yaml_only", reason: "The form supports exactly one event." };
  }
  const [event, definition] = events[0]!;
  if (!isEditorEvent(event)) {
    return { status: "yaml_only", reason: `The form does not support the ${event} event.` };
  }
  if ("choices" in trigger.run.agent) {
    return { status: "yaml_only", reason: "Agent choices can only be edited in YAML." };
  }
  const agent = trigger.run.agent;
  return {
    status: "editable",
    value: toFormValue(trigger, event, definition, agent),
  };
}

function toFormValue(
  trigger: TriggerDocument,
  event: EditorEvent,
  definition: TriggerDocument["on"][string],
  agent: Extract<TriggerDocument["run"]["agent"], { provider: string }>,
): TriggerFormValue {
  return {
    name: trigger.name,
    enabled: trigger.enabled,
    event,
    connection: definition.connection ?? "",
    allowedUsers: definition.filters?.from_users?.join(", ") ?? "*",
    daemon: trigger.run.target.daemon,
    cwd: trigger.run.target.cwd,
    agent: joinAgentId(agent.provider, agent.model),
    mode: agent.mode ?? "",
    thinkingOptionId: agent.thinkingOptionId ?? "",
    providerOptions: agent.options === undefined ? "" : JSON.stringify(agent.options, null, 2),
    maxRuntime: trigger.run.max_runtime,
    idleTimeout: trigger.run.idle_timeout,
    githubConnection: trigger.run.github?.connection ?? "",
    githubRepositories: trigger.run.github?.repositories?.join(", ") ?? "",
    githubPermissions:
      trigger.run.github?.permissions === undefined
        ? ""
        : JSON.stringify(trigger.run.github.permissions, null, 2),
    githubDuration: trigger.run.github?.duration ?? "",
    prompt: trigger.run.prompt,
  };
}

/** Patch only form-owned YAML nodes, retaining comments, ordering, and advanced nodes. */
export function patchTriggerYaml(yaml: string, value: TriggerFormValue): string {
  const projection = projectTriggerForm(yaml);
  if (projection.status !== "editable") throw new Error(projection.reason);
  if (sameFormValue(projection.value, value)) return yaml;
  validateFormValue(value);

  const document = parseDocument(yaml);
  assertDocument(document);
  setIfChanged(document, ["name"], value.name);
  setIfChanged(document, ["enabled"], value.enabled);

  const previousEvent = projection.value.event;
  if (previousEvent !== value.event) {
    const definition = document.getIn(["on", previousEvent], true);
    document.deleteIn(["on", previousEvent]);
    document.setIn(["on", value.event], definition ?? {});
  }
  if (value.event === "manual.run") {
    deleteIfPresent(document, ["on", value.event, "connection"]);
    deleteIfPresent(document, ["on", value.event, "filters", "from_users"]);
  } else {
    setIfChanged(document, ["on", value.event, "connection"], value.connection);
    setIfChanged(document, ["on", value.event, "filters", "from_users"], users(value.allowedUsers));
  }

  setIfChanged(document, ["run", "target", "daemon"], value.daemon);
  setIfChanged(document, ["run", "target", "cwd"], value.cwd);
  const agent = splitAgentId(value.agent);
  setIfChanged(document, ["run", "agent", "provider"], agent.provider);
  setOptional(document, ["run", "agent", "model"], agent.model);
  setIfChanged(document, ["run", "agent", "mode"], value.mode.trim());
  setOptional(
    document,
    ["run", "agent", "thinkingOptionId"],
    blankToUndefined(value.thinkingOptionId),
  );
  setOptional(document, ["run", "agent", "options"], parseProviderOptions(value.providerOptions));
  setIfChanged(document, ["run", "max_runtime"], value.maxRuntime.trim());
  setIfChanged(document, ["run", "idle_timeout"], value.idleTimeout.trim());
  setOptional(document, ["run", "github"], githubAuthority(value));
  setIfChanged(document, ["run", "prompt"], value.prompt);
  return document.toString({ lineWidth: 0 });
}

/** Create from an invalid/empty draft, otherwise retain the canonical document while patching it. */
export function mergeTriggerForm(yaml: string, value: TriggerFormValue): string {
  return projectTriggerForm(yaml).status === "editable"
    ? patchTriggerYaml(yaml, value)
    : createTriggerYaml(value);
}

export function createTriggerYaml(value: TriggerFormValue): string {
  validateFormValue(value);
  const agent = splitAgentId(value.agent);
  const providerOptions = parseProviderOptions(value.providerOptions);
  const github = githubAuthority(value);
  const definition =
    value.event === "manual.run"
      ? {}
      : { connection: value.connection, filters: { from_users: users(value.allowedUsers) } };
  return stringify(
    {
      name: value.name,
      enabled: value.enabled,
      on: { [value.event]: definition },
      run: {
        target: { daemon: value.daemon, cwd: value.cwd },
        agent: {
          provider: agent.provider,
          ...(agent.model === undefined ? {} : { model: agent.model }),
          mode: value.mode.trim(),
          ...(blankToUndefined(value.thinkingOptionId) === undefined
            ? {}
            : { thinkingOptionId: value.thinkingOptionId.trim() }),
          ...(providerOptions === undefined ? {} : { options: providerOptions }),
        },
        max_runtime: value.maxRuntime.trim(),
        idle_timeout: value.idleTimeout.trim(),
        ...(github === undefined ? {} : { github }),
        prompt: value.prompt,
      },
    },
    { lineWidth: 0 },
  );
}

function githubAuthority(value: TriggerFormValue) {
  const connection = blankToUndefined(value.githubConnection);
  if (connection === undefined) return undefined;
  const repositories = commaSeparated(value.githubRepositories);
  const permissions = parsePermissions(value.githubPermissions);
  const duration = blankToUndefined(value.githubDuration);
  return {
    connection,
    ...(repositories.length === 0 ? {} : { repositories }),
    ...(permissions === undefined ? {} : { permissions }),
    ...(duration === undefined ? {} : { duration }),
  };
}

function parsePermissions(value: string): Record<string, "read" | "write" | "admin"> | undefined {
  const parsed = parseProviderOptions(value);
  if (parsed === undefined) return undefined;
  return GitHubPermissionsSchema.parse(parsed);
}

function validateFormValue(value: TriggerFormValue): void {
  if (!value.cwd.trim().startsWith("/")) {
    throw new Error("Working directory must be an absolute path.");
  }
  if (value.mode.trim().length === 0) throw new Error("Execution mode is required.");
  if (value.maxRuntime.trim().length === 0) throw new Error("Maximum runtime is required.");
  if (value.idleTimeout.trim().length === 0) throw new Error("Idle timeout is required.");
}

export function parseProviderOptions(value: string): Record<string, unknown> | undefined {
  if (value.trim().length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Provider options must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Provider options must be a JSON object.");
  }
  return ProviderOptionsSchema.parse(parsed);
}

export function joinAgentId(provider: string, model: string | undefined): string {
  return model === undefined ? provider : `${provider}/${model}`;
}

export function splitAgentId(value: string): { provider: string; model?: string } {
  const normalized = value.trim();
  const separator = normalized.indexOf("/");
  if (separator < 0) {
    if (normalized.length === 0) throw new Error("Agent is required.");
    return { provider: normalized };
  }
  const provider = normalized.slice(0, separator).trim();
  const model = normalized.slice(separator + 1).trim();
  if (provider.length === 0 || model.length === 0) {
    throw new Error("Agent must look like provider/model.");
  }
  return { provider, model };
}

function parseEditorDocument(
  yaml: string,
): { success: true; data: TriggerDocument } | { success: false; error: string } {
  const document = parseDocument(yaml);
  if (document.errors.length > 0) return { success: false, error: document.errors[0]!.message };
  const parsed = TriggerDocumentSchema.safeParse(document.toJS());
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { success: false, error: `${issue.path.join(".") || "YAML"}: ${issue.message}` };
  }
  return { success: true, data: parsed.data };
}

function assertDocument(document: Document): void {
  if (document.errors.length > 0) throw new Error(document.errors[0]!.message);
}

function setIfChanged(document: Document, path: readonly string[], value: unknown): void {
  if (JSON.stringify(document.getIn(path)) !== JSON.stringify(value)) document.setIn(path, value);
}

function setOptional(document: Document, path: readonly string[], value: unknown): void {
  if (value === undefined) deleteIfPresent(document, path);
  else setIfChanged(document, path, value);
}

function deleteIfPresent(document: Document, path: readonly string[]): void {
  if (document.hasIn(path)) document.deleteIn(path);
}

function sameFormValue(left: TriggerFormValue, right: TriggerFormValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function users(value: string): string[] {
  const values = commaSeparated(value);
  return values.length === 0 ? ["*"] : values;
}

function commaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function blankToUndefined(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function isEditorEvent(value: string): value is EditorEvent {
  return EDITOR_EVENTS.some((event) => event === value);
}
