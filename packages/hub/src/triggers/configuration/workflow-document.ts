/* oxlint-disable oxc/no-map-spread -- Each event and projected step must be a separate immutable object. */
import { createHash } from "node:crypto";
import { load, dump } from "js-yaml";
import { z } from "zod";
import {
  AgentSchema,
  AuthoredTriggerSchema,
  HubConfigSchema,
  compileHubConfig,
  parseCompiledHubConfig,
  type CompiledAgent,
  type CompiledTrigger,
} from "../../config/compiler.js";
import type { Expression } from "../../workflows/expression.js";
import { compileTriggerDocument, TriggerDocumentError } from "./index.js";
import { TriggerEventSchema } from "./schema.js";

/** Workflow fields belong to the existing compiler; this envelope only supplies identity and events. */
export const WorkflowDocumentSchema = AuthoredTriggerSchema.omit({ on: true, filters: true })
  .extend({
    enabled: z.boolean().default(true),
    description: z.string().optional(),
    on: z
      .record(z.string(), TriggerEventSchema)
      .refine((value) => Object.keys(value).length > 0, "at least one input is required"),
    environments: HubConfigSchema.shape.environments,
    agents: z.record(z.string(), AgentSchema).optional(),
  })
  .strict();
export type WorkflowDocument = z.infer<typeof WorkflowDocumentSchema>;

export function compileAutomationDocument(yaml: string) {
  try {
    const raw: unknown = load(yaml);
    if (typeof raw === "object" && raw !== null && "run" in raw) {
      const single = compileTriggerDocument(yaml);
      return { ...single, environments: [single.environment], format: "single_run" as const };
    }
    const authored = WorkflowDocumentSchema.parse(raw);
    const {
      environments,
      agents,
      on,
      enabled: _enabled,
      description: _description,
      ...workflow
    } = authored;
    const compiled = compileHubConfig(
      {
        environments,
        triggers: Object.entries(on).map(([event, definition], index) => ({
          ...workflow,
          name: index === 0 ? authored.name : `${authored.name}-event-${index + 1}`,
          on: event,
          filters: {
            ...definition.filters,
            ...(event === "manual.run" && definition.filters?.from_users === undefined
              ? { from_users: ["*"] }
              : {}),
            ...(definition.connection === undefined ? {} : { connection: definition.connection }),
          },
        })),
      },
      agents === undefined ? {} : { namedAgents: agents },
    );
    return {
      authored,
      environments: compiled.environments,
      events: compiled.triggers,
      authoredHash: createHash("sha256").update(yaml).digest("hex"),
      format: "workflow" as const,
    };
  } catch (error) {
    if (error instanceof TriggerDocumentError) throw error;
    throw new TriggerDocumentError([
      { path: [], message: error instanceof Error ? error.message : "Invalid workflow" },
    ]);
  }
}

export function automationAgents(
  document: ReturnType<typeof compileAutomationDocument>,
): CompiledAgent[] {
  return document.events.flatMap((event) =>
    event.steps.flatMap((step) =>
      "selector" in step.agent ? Object.values(step.agent.choices) : [step.agent],
    ),
  );
}

/** Historical revisions stored compiled snapshots. Project them back to authoring without changing active data. */
export function editableAutomationYaml(yaml: string, enabled: boolean): string {
  const raw: unknown = load(yaml);
  if (typeof raw !== "object" || raw === null || !("legacy_multistep" in raw)) return yaml;
  const snapshot = raw.legacy_multistep;
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    !("trigger" in snapshot) ||
    !("environments" in snapshot)
  )
    throw new Error("Invalid stored workflow snapshot");
  const compiled = parseCompiledHubConfig({
    environments: snapshot.environments,
    triggers: [snapshot.trigger],
  });
  const trigger = compiled.triggers[0]!;
  const agents: Record<string, CompiledAgent> = {};
  const {
    connection,
    connectionId: _connectionId,
    resourceId: _resourceId,
    ...filters
  } = trigger.filters ?? {};
  const candidate = {
    name: trigger.name,
    enabled,
    on: { [trigger.on]: { ...(connection ? { connection } : {}), filters } },
    max_runtime: `${trigger.maxRuntimeMs}ms`,
    inputs: trigger.inputs,
    values: Object.fromEntries(
      Object.entries(trigger.values).map(([key, value]) => [key, expressionSource(value)]),
    ),
    environments: compiled.environments.map((environment) => {
      if (environment.kind !== "daemon") return environment;
      const { daemonId: _daemonId, ...authored } = environment;
      return authored;
    }),
    steps: trigger.steps.map((step) => ({
      id: step.id,
      environment: step.environment,
      agent: "selector" in step.agent ? mergeAgentChoices(step.agent, agents) : step.agent,
      prompt: step.prompt.map((block) => ({
        text: block.kind === "text" ? block.value : block.content,
      })),
      max_runtime: `${step.maxRuntimeMs}ms`,
      idle_timeout: `${step.idleTimeoutMs}ms`,
      ...(step.condition ? { if: expressionSource(step.condition) } : {}),
      ...(step.env ? { env: step.env } : {}),
      ...(step.github
        ? {
            github: {
              connection: step.github.connection,
              repositories: step.github.repositories,
              permissions: step.github.permissions,
              duration: `${step.github.durationMs}ms`,
            },
          }
        : {}),
      ...(step.output ? { output: step.output } : {}),
      allow_outputs: step.allowOutputs,
      auto_archive: step.autoArchive,
      ...(step.reuse ? { reuse: step.reuse } : {}),
    })),
    agents,
  };
  return dump(WorkflowDocumentSchema.parse(candidate), { noRefs: true, lineWidth: -1 });
}
function mergeAgentChoices(
  selection: Extract<CompiledTrigger["steps"][number]["agent"], { selector: string }>,
  agents: Record<string, CompiledAgent>,
) {
  for (const [name, agent] of Object.entries(selection.choices)) {
    if (agents[name] && JSON.stringify(agents[name]) !== JSON.stringify(agent))
      throw new Error(`Conflicting Agent choice ${name}`);
    agents[name] = agent;
  }
  return selection.selector;
}
function expressionSource(expression: Expression): string {
  return `\${{ ${expressionBody(expression)} }}`;
}
function expressionBody(expression: Expression): string {
  switch (expression.kind) {
    case "literal":
      return JSON.stringify(expression.value);
    case "not":
      return `!(${expressionBody(expression.value)})`;
    case "binary":
      return `(${expressionBody(expression.left)} ${expression.operator} ${expressionBody(expression.right)})`;
    case "path": {
      const path = expression.value;
      if (path.namespace === "steps")
        return `steps.${path.stepId}.outputs${path.path.length ? `.${path.path.join(".")}` : ""}`;
      if (path.namespace === "values") return `values.${path.name}`;
      return `paseo.${Array.isArray(path.path) ? path.path.join(".") : path.path}`;
    }
  }
  throw new Error("Unsupported workflow expression");
}
