import { parse, stringify } from "yaml";
import { parseWorktreeTarget, type WorktreeTarget } from "./workspace-configuration";

export interface SingleAgentAutomationInput {
  name: string;
  description?: string;
  enabled?: boolean;
  events: readonly AutomationEventValue[];
  inputs?: readonly AutomationInputValue[];
  daemonId: string;
  projectId?: string;
  cwd: string;
  worktree?: WorktreeTarget;
  provider: string;
  model?: string;
  mode?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
  options?: Record<string, unknown>;
  instruction: string;
  reuseBinding?: boolean;
  maxRuntime?: string;
  idleTimeout?: string;
  autoArchive?: boolean;
  outputSchema?: Record<string, unknown>;
  outputs?: readonly AutomationOutputValue[];
}

export interface AutomationEventValue {
  name: string;
  connection?: string;
  allowedUsers?: readonly string[];
  repository?: string;
  contains?: string;
}

export interface AutomationInputValue {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  default?: string | number | boolean;
  choices?: readonly (string | number | boolean)[];
}

export interface AutomationOutputValue {
  type: string;
  max?: number;
  required?: boolean;
}

export interface AutomationRouteBacklink {
  channel: string;
  accountId: string;
  routePosition: number | "fallback";
}

export function normalizeAutomationName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^[^a-z]+/u, "")
    .replace(/-+$/u, "");
  return normalized;
}

export function normalizeAutomationInputName(value: string): string {
  return normalizeAutomationName(value);
}

/** Reads the current Channel candidate without making Routes a separate resource. */
export function automationRouteBacklinks(
  accounts: readonly Record<string, unknown>[],
  automationName: string,
): AutomationRouteBacklink[] {
  const result: AutomationRouteBacklink[] = [];
  for (const account of accounts) {
    const channel = stringValue(account["channel"]);
    const accountId = stringValue(account["accountId"]);
    if (channel === null || accountId === null) continue;
    const routes = account["routes"];
    if (Array.isArray(routes)) {
      routes.forEach((route, index) => {
        if (isRecord(route) && route["workflow"] === automationName) {
          result.push({ channel, accountId, routePosition: index });
        }
      });
    }
    const fallback = account["fallback"];
    if (isRecord(fallback) && fallback["workflow"] === automationName) {
      result.push({ channel, accountId, routePosition: "fallback" });
    }
  }
  return result;
}

export function buildSingleAgentAutomationYaml(input: SingleAgentAutomationInput): string {
  const instruction = input.instruction.trim();
  const prompt = instruction
    ? `${instruction}\n\nRequest:\n\${{ paseo.prompt }}`
    : "${{ paseo.prompt }}";
  const document = {
    name: normalizeAutomationName(input.name),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    enabled: input.enabled ?? true,
    on: buildAutomationEvents(input.events),
    ...(input.inputs && input.inputs.length > 0
      ? { inputs: buildAutomationInputs(input.inputs) }
      : {}),
    run: {
      target: buildAutomationTarget(input),
      agent: buildAutomationAgent(input),
      prompt,
      max_runtime: input.maxRuntime?.trim() || "2h",
      idle_timeout: input.idleTimeout?.trim() || "10m",
      ...(input.outputSchema === undefined ? {} : { output: { schema: input.outputSchema } }),
      ...(input.outputs === undefined || input.outputs.length === 0
        ? {}
        : {
            outputs: buildAutomationOutputs(input.outputs),
          }),
      auto_archive: input.autoArchive ?? true,
      ...(input.reuseBinding === true ? { reuse: "binding" } : {}),
    },
  };
  return stringify(document, { lineWidth: 0 });
}

function buildAutomationEvents(events: readonly AutomationEventValue[]): Record<string, unknown> {
  // The Workflow compiler needs an event to compile its steps even for Route-only work.
  const authoredEvents: readonly AutomationEventValue[] =
    events.length === 0 ? [{ name: "channel.message" }] : events;
  return Object.fromEntries(
    authoredEvents.map((event) => {
      // Channel admission already checks the Route audience and linked identity.
      // The compiled Workflow still needs an explicit external-event allowlist.
      const defaultUsers = event.name === "channel.message" ? ["*"] : [];
      const allowedUsers = event.allowedUsers ?? defaultUsers;
      return [
        event.name,
        {
          ...(event.connection?.trim() ? { connection: event.connection.trim() } : {}),
          ...(allowedUsers.length > 0 || event.repository?.trim() || event.contains?.trim()
            ? {
                filters: {
                  ...(allowedUsers.length ? { from_users: [...allowedUsers] } : {}),
                  ...(event.repository?.trim() ? { repo: event.repository.trim() } : {}),
                  ...(event.contains?.trim() ? { contains: event.contains.trim() } : {}),
                },
              }
            : {}),
        },
      ];
    }),
  );
}

function buildAutomationInputs(inputs: readonly AutomationInputValue[]): Record<string, unknown> {
  return Object.fromEntries(
    inputs.map(({ name, type, required, default: defaultValue, choices }) => [
      normalizeAutomationInputName(name),
      {
        type,
        ...(required ? { required: true } : {}),
        ...(defaultValue === undefined ? {} : { default: defaultValue }),
        ...(choices === undefined || choices.length === 0 ? {} : { choices: [...choices] }),
      },
    ]),
  );
}

function buildAutomationTarget(input: SingleAgentAutomationInput): Record<string, unknown> {
  return {
    daemon: input.daemonId,
    ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
    cwd: input.cwd.trim(),
    ...(input.worktree === undefined ? {} : { worktree: input.worktree }),
  };
}

function buildAutomationAgent(input: SingleAgentAutomationInput): Record<string, unknown> {
  return {
    provider: input.provider.trim(),
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.mode?.trim() ? { mode: input.mode.trim() } : {}),
    ...(input.thinkingOptionId?.trim() ? { thinkingOptionId: input.thinkingOptionId.trim() } : {}),
    ...(input.featureValues !== undefined && Object.keys(input.featureValues).length > 0
      ? { featureValues: input.featureValues }
      : {}),
    ...(input.options !== undefined && Object.keys(input.options).length > 0
      ? { options: input.options }
      : {}),
  };
}

function buildAutomationOutputs(
  outputs: readonly AutomationOutputValue[],
): Record<string, unknown> {
  return Object.fromEntries(
    outputs.map((output) => [
      output.type,
      {
        ...(output.max === undefined ? {} : { max: output.max }),
        ...(output.required === true ? { required: true } : {}),
      },
    ]),
  );
}

export interface SingleAgentAutomationValue {
  name: string;
  description: string;
  enabled: boolean;
  events: AutomationEventValue[];
  inputs: AutomationInputValue[];
  daemonId: string;
  projectId: string | null;
  cwd: string;
  worktree?: WorktreeTarget;
  provider: string;
  model: string;
  mode: string;
  thinkingOptionId: string;
  featureValues: Record<string, unknown>;
  options: Record<string, unknown>;
  instruction: string;
  reuseBinding: boolean;
  maxRuntime: string;
  idleTimeout: string;
  autoArchive: boolean;
  outputSchema?: Record<string, unknown>;
  outputs: AutomationOutputValue[];
}

/**
 * Returns a structured-edit value only for the intentionally small one-Agent
 * Automation shape the shared form can round-trip without dropping fields.
 */
export function parseSingleAgentAutomationYaml(source: string): SingleAgentAutomationValue | null {
  let value: unknown;
  try {
    value = parse(source);
  } catch {
    return null;
  }
  const document = parseAutomationDocument(value);
  if (document === null) return null;
  const run = parseAutomationRun(document.run);
  return run === null ? null : { ...document.value, ...run };
}

function parseAutomationDocument(value: unknown): {
  value: Pick<SingleAgentAutomationValue, "name" | "description" | "enabled" | "events" | "inputs">;
  run: Record<string, unknown>;
} | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["name", "description", "enabled", "on", "inputs", "run"])
  )
    return null;
  const name = stringValue(value["name"]);
  const description = optionalString(value["description"]);
  const enabled = value["enabled"];
  const on = value["on"];
  const inputs = parseInputs(value["inputs"]);
  const run = value["run"];
  if (
    name === null ||
    description === null ||
    typeof enabled !== "boolean" ||
    !isRecord(on) ||
    inputs === null ||
    !isRecord(run) ||
    !hasOnlyKeys(run, [
      "target",
      "agent",
      "prompt",
      "max_runtime",
      "idle_timeout",
      "auto_archive",
      "reuse",
      "output",
      "outputs",
    ])
  )
    return null;
  const events = parseEvents(on);
  if (events === null || events.length === 0) return null;
  return { value: { name, description, enabled, events, inputs }, run };
}

function parseAutomationRun(
  run: Record<string, unknown>,
): Omit<
  SingleAgentAutomationValue,
  "name" | "description" | "enabled" | "events" | "inputs"
> | null {
  if (
    !hasOnlyKeys(run, [
      "target",
      "agent",
      "prompt",
      "max_runtime",
      "idle_timeout",
      "auto_archive",
      "reuse",
      "output",
      "outputs",
    ]) ||
    stringValue(run["max_runtime"]) === null ||
    stringValue(run["idle_timeout"]) === null ||
    typeof run["auto_archive"] !== "boolean" ||
    (run["reuse"] !== undefined && run["reuse"] !== "binding")
  )
    return null;
  const target = parseAutomationTarget(run["target"]);
  const agent = parseAutomationAgent(run["agent"]);
  const instruction = parseManagedPrompt(run["prompt"]);
  const outputSchema = parseOutputSchema(run["output"]);
  const outputs = parseOutputs(run["outputs"]);
  if (
    target === null ||
    agent === null ||
    instruction === null ||
    outputSchema === null ||
    outputs === null
  )
    return null;
  return {
    ...target,
    ...agent,
    instruction,
    reuseBinding: run["reuse"] === "binding",
    maxRuntime: stringValue(run["max_runtime"])!,
    idleTimeout: stringValue(run["idle_timeout"])!,
    autoArchive: run["auto_archive"] as boolean,
    ...(outputSchema === undefined ? {} : { outputSchema }),
    outputs,
  };
}

function parseAutomationTarget(
  value: unknown,
): Pick<SingleAgentAutomationValue, "daemonId" | "projectId" | "cwd" | "worktree"> | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["daemon", "projectId", "cwd", "worktree"])) {
    return null;
  }
  const daemonId = stringValue(value["daemon"]);
  const cwd = stringValue(value["cwd"]);
  const worktree =
    value["worktree"] === undefined ? undefined : parseWorktreeTarget(value["worktree"]);
  if (daemonId === null || cwd === null || worktree === null) return null;
  return {
    daemonId,
    projectId: stringValue(value["projectId"]),
    cwd,
    ...(worktree === undefined ? {} : { worktree }),
  };
}

function parseAutomationAgent(
  value: unknown,
): Pick<
  SingleAgentAutomationValue,
  "provider" | "model" | "mode" | "thinkingOptionId" | "featureValues" | "options"
> | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "provider",
      "model",
      "mode",
      "thinkingOptionId",
      "featureValues",
      "options",
    ])
  ) {
    return null;
  }
  const provider = stringValue(value["provider"]);
  const featureValues = optionalRecord(value["featureValues"]);
  const options = optionalRecord(value["options"]);
  if (provider === null || featureValues === null || options === null) return null;
  return {
    provider,
    model: stringValue(value["model"]) ?? "",
    mode: stringValue(value["mode"]) ?? "",
    thinkingOptionId: stringValue(value["thinkingOptionId"]) ?? "",
    featureValues,
    options,
  };
}

const PROMPT_SUFFIX = "\n\nRequest:\n${{ paseo.prompt }}";

function parseManagedPrompt(value: unknown): string | null {
  if (value === "${{ paseo.prompt }}") return "";
  if (typeof value !== "string" || !value.endsWith(PROMPT_SUFFIX)) return null;
  return value.slice(0, -PROMPT_SUFFIX.length);
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return {};
  return isRecord(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  if (value === undefined) return "";
  return typeof value === "string" ? value : null;
}

function parseEvents(on: Record<string, unknown>): AutomationEventValue[] | null {
  const events: AutomationEventValue[] = [];
  for (const [name, definition] of Object.entries(on)) {
    if (!isRecord(definition) || !hasOnlyKeys(definition, ["connection", "filters"])) {
      return null;
    }
    const connection = optionalString(definition["connection"]);
    if (connection === null) return null;
    const filters = definition["filters"];
    let allowedUsers: string[] | undefined;
    let repository: string | undefined;
    let contains: string | undefined;
    if (filters !== undefined) {
      if (
        !isRecord(filters) ||
        !hasOnlyKeys(
          filters,
          name.startsWith("github.") ? ["from_users", "repo", "contains"] : ["from_users"],
        )
      )
        return null;
      const users = filters["from_users"];
      if (!Array.isArray(users) || !users.every((user) => typeof user === "string")) {
        return null;
      }
      allowedUsers = users;
      if (filters.repo !== undefined && typeof filters.repo !== "string") return null;
      if (filters.contains !== undefined && typeof filters.contains !== "string") return null;
      repository = filters.repo as string | undefined;
      contains = filters.contains as string | undefined;
    }
    events.push({
      name,
      ...(connection ? { connection } : {}),
      ...(allowedUsers === undefined ? {} : { allowedUsers }),
      ...(repository === undefined ? {} : { repository }),
      ...(contains === undefined ? {} : { contains }),
    });
  }
  return events;
}

function parseInputs(value: unknown): AutomationInputValue[] | null {
  if (value === undefined) return [];
  if (!isRecord(value)) return null;
  const result: AutomationInputValue[] = [];
  for (const [name, definition] of Object.entries(value)) {
    if (
      !isRecord(definition) ||
      !hasOnlyKeys(definition, ["type", "required", "default", "choices"])
    ) {
      return null;
    }
    const type = definition["type"];
    const required = definition["required"] ?? false;
    const defaultValue = definition["default"];
    const choices = definition["choices"];
    if (
      (type !== "string" && type !== "number" && type !== "boolean") ||
      typeof required !== "boolean" ||
      (defaultValue !== undefined && !isInputValue(defaultValue)) ||
      (choices !== undefined &&
        (!Array.isArray(choices) || choices.length === 0 || !choices.every(isInputValue)))
    ) {
      return null;
    }
    result.push({
      name,
      type,
      required,
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
      ...(choices === undefined ? {} : { choices }),
    });
  }
  return result;
}

function parseOutputSchema(value: unknown): Record<string, unknown> | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !hasOnlyKeys(value, ["schema"]) || !isRecord(value["schema"])) {
    return null;
  }
  return value["schema"];
}

function parseOutputs(value: unknown): AutomationOutputValue[] | null {
  if (value === undefined) return [];
  if (!isRecord(value)) return null;
  const result: AutomationOutputValue[] = [];
  for (const [type, definition] of Object.entries(value)) {
    if (!isRecord(definition) || !hasOnlyKeys(definition, ["max", "required"])) return null;
    const max = definition["max"];
    const required = definition["required"];
    if (
      (max !== undefined && (!Number.isInteger(max) || (max as number) <= 0)) ||
      (required !== undefined && typeof required !== "boolean")
    ) {
      return null;
    }
    result.push({
      type,
      ...(max === undefined ? {} : { max: max as number }),
      ...(required === undefined ? {} : { required }),
    });
  }
  return result;
}

function isInputValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const names = new Set(allowed);
  return Object.keys(value).every((key) => names.has(key));
}

export function initialChannelReplyProviders(
  outputs: readonly AutomationOutputValue[],
  provider?: "slack" | "telegram",
): Array<"slack" | "telegram"> {
  return (["slack", "telegram"] as const).filter(
    (candidate) =>
      candidate === provider || outputs.some(({ type }) => type === `${candidate}.reply`),
  );
}

/** Channel dispatch runs the first compiled event's steps, including its native reply default. */
export function automationChannelReplyGrant(
  value: Pick<SingleAgentAutomationValue, "events" | "outputs">,
  channel: string,
): AutomationOutputValue | undefined {
  const type = `${channel}.reply`;
  const explicit = value.outputs.find((output) => output.type === type);
  if (explicit !== undefined) return explicit;
  const firstProvider = value.events[0]?.name.split(".", 1)[0];
  if (firstProvider === channel && ["slack", "discord", "github", "linear"].includes(channel)) {
    return { type };
  }
  return undefined;
}

/** Direct event output defaults and explicit Channel reply grants share the existing run.outputs owner. */
export function automationOutputs(
  existing: readonly AutomationOutputValue[],
  events: readonly AutomationEventValue[],
  replyLimits: Readonly<Record<string, string>>,
  channelReplyProviders: readonly ("slack" | "telegram")[],
): AutomationOutputValue[] {
  const eventProviders = events
    .map(({ name }) => name.split(".", 1)[0])
    .filter((provider) => ["slack", "discord", "github", "linear"].includes(provider));
  const providers = new Set([...eventProviders, ...channelReplyProviders]);
  const managedTypes = new Set(
    [...eventProviders, "slack", "telegram"].map((provider) => `${provider}.reply`),
  );
  const outputs = existing
    .filter(({ type }) => !managedTypes.has(type))
    .map((output) => Object.assign({}, output));
  for (const provider of providers) {
    const type = `${provider}.reply`;
    const value = replyLimits[type]?.trim() ?? "";
    const previous = existing.find((output) => output.type === type);
    const explicitChannelReply = channelReplyProviders.some((candidate) => candidate === provider);
    if (value.length === 0 && !explicitChannelReply && previous?.required !== true) continue;
    outputs.push({
      type,
      ...(value.length === 0 ? {} : { max: Number(value) }),
      ...(previous?.required === true ? { required: true } : {}),
    });
  }
  return outputs;
}

/** Replies belong to individual Workflow steps. Shorthand retains its existing native defaults. */
export function automationYamlChannelReplyGrant(
  yaml: string,
  channel: string,
): AutomationOutputValue | undefined {
  const single = parseSingleAgentAutomationYaml(yaml);
  if (single) return automationChannelReplyGrant(single, channel);
  let document: unknown;
  try {
    document = parse(yaml);
  } catch {
    return undefined;
  }
  if (!isRecord(document) || !Array.isArray(document.steps)) return undefined;
  for (const step of document.steps) {
    if (!isRecord(step) || !Array.isArray(step.allow_outputs)) continue;
    for (const output of step.allow_outputs) {
      if (isRecord(output) && output.type === `${channel}.reply`)
        return {
          type: `${channel}.reply`,
          ...(typeof output.max === "number" ? { max: output.max } : {}),
          ...(typeof output.required === "boolean" ? { required: output.required } : {}),
        };
    }
  }
  return undefined;
}

export function automationManualParameters(yaml: string): AutomationInputValue[] | null {
  try {
    const document: unknown = parse(yaml);
    if (!isRecord(document) || !isRecord(document.on) || !("manual.run" in document.on))
      return null;
    return parseInputs(document.inputs);
  } catch {
    return null;
  }
}
