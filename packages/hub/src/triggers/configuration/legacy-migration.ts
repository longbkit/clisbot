import { dump } from "js-yaml";
import { compileHubBundle, type HubBundleFile } from "../../config/bundle.js";
import type {
  CompiledAgent,
  CompiledAgentSelection,
  CompiledEnvironment,
  CompiledHubConfig,
  CompiledInput,
  CompiledStep,
  CompiledTrigger,
  JsonPrimitive,
} from "../../config/compiler.js";
import { parseCompiledHubConfig } from "../../config/compiler.js";
import type { TriggerDocument } from "./schema.js";
import { compileTriggerDocument, serializeTriggerDocument } from "./index.js";

export type MigratedLegacyTrigger =
  | {
      format: "single_run";
      name: string;
      yaml: string;
      compiled: ReturnType<typeof compileTriggerDocument>;
      legacySourceFile: string | null;
      legacyStepIds: readonly string[];
    }
  | {
      format: "legacy_multistep";
      name: string;
      yaml: string;
      normalized: SelfContainedLegacyTrigger;
      legacySourceFile: string | null;
      conversionBlockers: readonly string[];
      authoredYaml: string;
      legacyStepIds: readonly string[];
    };

export interface SelfContainedLegacyTrigger {
  trigger: CompiledTrigger;
  environments: readonly CompiledEnvironment[];
}

export function migrateLegacyBundle(input: {
  files: readonly HubBundleFile[];
  normalizedConfiguration?: unknown;
}): readonly MigratedLegacyTrigger[] {
  const bundle = compileHubBundle(input.files);
  const configuration =
    input.normalizedConfiguration === undefined
      ? bundle.configuration
      : parseCompiledHubConfig(input.normalizedConfiguration);
  const authoredByPath = new Map(bundle.files.map((file) => [file.path, file.content]));
  return configuration.triggers.map((trigger) => {
    const sourceFile = trigger.sourceFile ?? null;
    const authoredYaml =
      sourceFile === null
        ? dump(trigger, { noRefs: true, lineWidth: -1 })
        : (authoredByPath.get(sourceFile) ?? dump(trigger, { noRefs: true, lineWidth: -1 }));
    const converted = convertSingleRun(trigger, configuration);
    return converted.success
      ? {
          format: "single_run" as const,
          name: trigger.name,
          yaml: serializeTriggerDocument(converted.trigger),
          compiled: compileTriggerDocument(serializeTriggerDocument(converted.trigger)),
          legacySourceFile: sourceFile,
          legacyStepIds: trigger.steps.map(({ id }) => id),
        }
      : {
          format: "legacy_multistep" as const,
          name: trigger.name,
          yaml: serializeLegacyTrigger({ trigger, environments: configuration.environments }),
          normalized: { trigger, environments: configuration.environments },
          legacySourceFile: sourceFile,
          conversionBlockers: converted.blockers,
          authoredYaml,
          legacyStepIds: trigger.steps.map(({ id }) => id),
        };
  });
}

function serializeLegacyTrigger(snapshot: SelfContainedLegacyTrigger): string {
  return dump(
    { name: snapshot.trigger.name, legacy_multistep: snapshot },
    { noRefs: true, lineWidth: -1, sortKeys: false },
  );
}

type SingleRunConversion =
  | { success: true; trigger: TriggerDocument }
  | { success: false; blockers: readonly string[] };

function convertSingleRun(
  trigger: CompiledTrigger,
  configuration: CompiledHubConfig,
): SingleRunConversion {
  const blockers: string[] = [];
  if (trigger.steps.length !== 1) blockers.push("trigger has multiple steps");
  if (Object.keys(trigger.values).length > 0) blockers.push("trigger defines workflow values");
  const step = trigger.steps[0];
  if (step === undefined) return { success: false, blockers };
  if (step.condition !== undefined) blockers.push("run is conditional");
  if (hasNullableInputs(trigger.inputs)) blockers.push("trigger inputs allow null values");
  const environment = configuration.environments.find(
    (candidate) => candidate.name === step.environment,
  );
  if (environment === undefined) blockers.push("target environment is selected dynamically");
  else if (environment.kind !== "daemon")
    blockers.push(`target kind ${environment.kind} is legacy`);
  if (hasDuplicateOutputs(step)) blockers.push("run contains duplicate output grants");
  if (blockers.length > 0 || environment === undefined || environment.kind !== "daemon") {
    return { success: false, blockers };
  }

  return { success: true, trigger: singleRunDocument(trigger, step, environment) };
}

function singleRunDocument(
  trigger: CompiledTrigger,
  step: CompiledStep,
  environment: Extract<CompiledEnvironment, { kind: "daemon" }>,
): TriggerDocument {
  const filters = trigger.filters === undefined ? undefined : authoredFilters(trigger.filters);
  const connection = trigger.filters?.connection;
  const outputs = Object.fromEntries(
    step.allowOutputs.map((output) => [
      output.type,
      {
        max: output.max,
        ...(output.required ? { required: true } : {}),
      },
    ]),
  );
  const event = {
    ...(connection === undefined ? {} : { connection }),
    ...(filters === undefined || Object.keys(filters).length === 0 ? {} : { filters }),
  };
  return {
    name: trigger.name,
    enabled: true,
    on: { [trigger.on]: event },
    ...(Object.keys(trigger.inputs).length === 0 ? {} : { inputs: authoredInputs(trigger.inputs) }),
    ...(trigger.maxRuntimeMs === step.maxRuntimeMs
      ? {}
      : { max_runtime: duration(trigger.maxRuntimeMs) }),
    run: {
      target: {
        daemon: environment.daemon,
        cwd: environment.cwd,
        ...(environment.worktree === undefined ? {} : { worktree: environment.worktree }),
      },
      agent: authoredAgent(step.agent),
      prompt: step.prompt
        .map((block) => (block.kind === "text" ? block.value : block.content))
        .join("\n"),
      max_runtime: duration(step.maxRuntimeMs),
      idle_timeout: duration(step.idleTimeoutMs),
      ...(step.env === undefined ? {} : { env: { ...step.env } }),
      ...(step.github === undefined
        ? {}
        : {
            github: {
              connection: step.github.connection,
              ...(step.github.repositories === undefined
                ? {}
                : { repositories: [...step.github.repositories] }),
              permissions: { ...step.github.permissions },
              duration: duration(step.github.durationMs),
            },
          }),
      ...(step.output === undefined
        ? {}
        : { output: { schema: structuredClone(asJsonObject(step.output.schema)) } }),
      ...(Object.keys(outputs).length === 0 ? {} : { outputs }),
      auto_archive: step.autoArchive,
    },
  };
}

function authoredAgent(agent: CompiledAgentSelection): TriggerDocument["run"]["agent"] {
  if (!("selector" in agent)) return cloneAgent(agent);
  return {
    select: agent.selector,
    choices: Object.fromEntries(
      Object.entries(agent.choices).map(([name, choice]) => [name, cloneAgent(choice)]),
    ),
  };
}

function cloneAgent(agent: CompiledAgent): CompiledAgent {
  return {
    ...agent,
    ...(agent.options === undefined ? {} : { options: structuredClone(agent.options) }),
  };
}

function authoredInputs(
  inputs: Readonly<Record<string, CompiledInput>>,
): NonNullable<TriggerDocument["inputs"]> {
  return Object.fromEntries(
    Object.entries(inputs).map(([name, input]) => [
      name,
      {
        type: input.type,
        ...(input.required ? { required: true } : {}),
        ...(input.default === undefined || input.default === null
          ? {}
          : { default: input.default }),
        ...(input.choices === undefined
          ? {}
          : { choices: input.choices.filter((choice) => choice !== null) }),
      },
    ]),
  );
}

function authoredFilters(
  filters: NonNullable<CompiledTrigger["filters"]>,
): TriggerDocument["on"][string]["filters"] | undefined {
  const {
    connection: _connection,
    connectionId: _connectionId,
    resourceId: _resourceId,
    ...rest
  } = filters;
  if (Object.keys(rest).length === 0) return undefined;
  return {
    pattern: rest.pattern,
    contains: rest.contains,
    label: rest.label,
    labels: rest.labels === undefined ? undefined : [...rest.labels],
    repo: rest.repo,
    guild: rest.guild,
    workspace: rest.workspace,
    project: rest.project,
    states: rest.states === undefined ? undefined : [...rest.states],
    exclude_labels: rest.exclude_labels === undefined ? undefined : [...rest.exclude_labels],
    assignees: rest.assignees === undefined ? undefined : [...rest.assignees],
    channels: rest.channels === undefined ? undefined : [...rest.channels],
    from_users: rest.from_users === undefined ? undefined : [...rest.from_users],
    inputs: rest.inputs === undefined ? undefined : { ...rest.inputs },
  };
}

function hasNullableInputs(inputs: Readonly<Record<string, CompiledInput>>): boolean {
  return Object.values(inputs).some(
    (input) => input.default === null || input.choices?.some((choice) => choice === null) === true,
  );
}

function asJsonObject(value: JsonPrimitive | readonly unknown[] | object): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("compiled output schema is not an object");
  }
  return Object.fromEntries(Object.entries(value));
}

function hasDuplicateOutputs(step: CompiledStep): boolean {
  return new Set(step.allowOutputs.map(({ type }) => type)).size !== step.allowOutputs.length;
}

function duration(milliseconds: number): string {
  if (milliseconds % 3_600_000 === 0) return `${String(milliseconds / 3_600_000)}h`;
  if (milliseconds % 60_000 === 0) return `${String(milliseconds / 60_000)}m`;
  if (milliseconds % 1000 === 0) return `${String(milliseconds / 1000)}s`;
  return `${String(milliseconds)}ms`;
}
