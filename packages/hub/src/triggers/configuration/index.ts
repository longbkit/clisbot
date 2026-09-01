import { createHash } from "node:crypto";
import { dump, load } from "js-yaml";
import {
  compileHubConfig,
  type AuthoredStep,
  type AuthoredTrigger,
  type CompiledEnvironment,
  type CompiledTrigger,
} from "../../config/compiler.js";
import { TriggerDocumentSchema, type TriggerDocument } from "./schema.js";

export { TriggerDocumentSchema, type TriggerDocument } from "./schema.js";
export {
  migrateLegacyBundle,
  type MigratedLegacyTrigger,
  type SelfContainedLegacyTrigger,
} from "./legacy-migration.js";

export interface TriggerDocumentIssue {
  path: readonly (string | number)[];
  message: string;
}

export class TriggerDocumentError extends Error {
  constructor(readonly issues: readonly TriggerDocumentIssue[]) {
    super(issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
    this.name = "TriggerDocumentError";
  }
}

export interface CompiledTriggerDocument {
  authored: TriggerDocument;
  environment: CompiledEnvironment;
  events: readonly CompiledTrigger[];
  authoredHash: string;
}

export function compileTriggerDocument(yaml: string): CompiledTriggerDocument {
  const authored = parseTriggerDocument(yaml);
  const namedAgents = "choices" in authored.run.agent ? authored.run.agent.choices : undefined;
  const agent = "choices" in authored.run.agent ? authored.run.agent.select : authored.run.agent;
  const environment = {
    name: "target",
    kind: "daemon" as const,
    ...authored.run.target,
  };
  const allowOutputs: NonNullable<AuthoredStep["allow_outputs"]> = [];
  for (const [type, output] of Object.entries(authored.run.outputs ?? {})) {
    const grant: NonNullable<AuthoredStep["allow_outputs"]>[number] = { type };
    if (output.max !== undefined) grant.max = output.max;
    if (output.required !== undefined) grant.required = output.required;
    allowOutputs.push(grant);
  }
  const triggers: AuthoredTrigger[] = [];
  for (const [index, [event, definition]] of Object.entries(authored.on).entries()) {
    const compiledTrigger: AuthoredTrigger = {
      name: internalEventName(authored.name, index),
      on: event,
      max_runtime: authored.max_runtime ?? authored.run.max_runtime,
      filters: authoredFilters(event, definition),
      steps: [
        {
          id: "run",
          environment: "target",
          max_runtime: authored.run.max_runtime,
          idle_timeout: authored.run.idle_timeout,
          agent,
          prompt: [{ text: authored.run.prompt }],
          ...(authored.run.env === undefined ? {} : { env: authored.run.env }),
          ...(authored.run.github === undefined ? {} : { github: authored.run.github }),
          ...(authored.run.output === undefined ? {} : { output: authored.run.output }),
          ...(allowOutputs.length === 0 ? {} : { allow_outputs: allowOutputs }),
          auto_archive: authored.run.auto_archive,
        },
      ],
    };
    if (authored.inputs !== undefined) compiledTrigger.inputs = authored.inputs;
    triggers.push(compiledTrigger);
  }
  let compiled: ReturnType<typeof compileHubConfig>;
  try {
    compiled = compileHubConfig(
      {
        environments: [environment],
        triggers,
      },
      namedAgents === undefined ? {} : { namedAgents },
    );
  } catch (error) {
    throw new TriggerDocumentError([
      { path: [], message: error instanceof Error ? error.message : "trigger compilation failed" },
    ]);
  }
  const compiledEnvironment = compiled.environments[0];
  if (compiledEnvironment === undefined) {
    throw new Error("compiled trigger target is missing");
  }
  return {
    authored,
    environment: compiledEnvironment,
    events: compiled.triggers.map(withAutomaticReply),
    authoredHash: createHash("sha256").update(yaml).digest("hex"),
  };
}

function withAutomaticReply(trigger: CompiledTrigger): CompiledTrigger {
  const replyType = automaticReplyType(trigger.on);
  if (replyType === undefined) return trigger;
  return {
    ...trigger,
    steps: trigger.steps.map((step) => ({
      ...step,
      allowOutputs: step.allowOutputs.some(({ type }) => type === replyType)
        ? step.allowOutputs
        : [...step.allowOutputs, { type: replyType, required: false }],
    })),
  };
}

function automaticReplyType(event: string): string | undefined {
  const provider = event.split(".", 1)[0];
  return provider === "slack" ||
    provider === "discord" ||
    provider === "linear" ||
    provider === "github"
    ? `${provider}.reply`
    : undefined;
}

function authoredFilters(
  event: string,
  definition: TriggerDocument["on"][string],
): NonNullable<AuthoredTrigger["filters"]> {
  return {
    ...definition.filters,
    ...(event === "manual.run" && definition.filters?.from_users === undefined
      ? { from_users: ["*"] }
      : {}),
    ...(definition.connection === undefined ? {} : { connection: definition.connection }),
  };
}

export function parseTriggerDocument(yaml: string): TriggerDocument {
  let input: unknown;
  try {
    input = load(yaml);
  } catch (error) {
    throw new TriggerDocumentError([
      { path: [], message: error instanceof Error ? error.message : "invalid YAML" },
    ]);
  }
  const parsed = TriggerDocumentSchema.safeParse(input);
  if (!parsed.success) {
    throw new TriggerDocumentError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map((segment) =>
          typeof segment === "symbol" ? (segment.description ?? String(segment)) : segment,
        ),
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

export function serializeTriggerDocument(trigger: TriggerDocument): string {
  return dump(trigger, { noRefs: true, lineWidth: -1, sortKeys: false });
}

function internalEventName(name: string, index: number): string {
  return index === 0 ? name : `${name}-event-${String(index + 1)}`;
}
