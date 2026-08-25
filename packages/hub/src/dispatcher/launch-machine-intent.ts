import type { AllowedOutput } from "../execution-capabilities/outputs.js";
import type { TriggerAgentConfig } from "../triggers/index.js";
import type { WorktreeTarget } from "../config/index.js";
import type { JsonValue } from "../config/compiler.js";
import type { CompiledGitHubAuthority } from "../config/github-authority.js";

export interface DaemonEnvironmentTarget {
  kind: "daemon";
  daemonId: string;
  authoredSlug: string;
  cwd: string;
  env?: Record<string, string>;
  worktree?: WorktreeTarget;
}

export interface LaunchMachineIntent {
  kind: "launch_machine";
  organizationId: string;
  projectId: string;
  triggerRunId: string;
  workflowStepRunId?: string;
  triggerName: string;
  environmentName: string;
  environment: DaemonEnvironmentTarget;
  env?: Readonly<Record<string, string>>;
  github?: CompiledGitHubAuthority;
  prompt: string;
  agent: TriggerAgentConfig;
  allowOutputs: readonly AllowedOutput[];
  timeoutMs?: number;
  idleTimeoutMs?: number;
  autoArchive: boolean;
  triggerContext: unknown;
  outputContext: unknown;
  outputSchema?: JsonValue;
  configurationRevisionId: string;
  deadlineAt?: Date;
  hubConfig: unknown;
}

export function buildLaunchMachineIntent(input: {
  organizationId: string;
  projectId: string;
  triggerRunId: string;
  configurationRevisionId: string;
  triggerName: string;
  environmentName: string;
  environment: DaemonEnvironmentTarget;
  env?: Readonly<Record<string, string>>;
  github?: CompiledGitHubAuthority;
  prompt: string;
  agent: TriggerAgentConfig;
  allowOutputs: readonly AllowedOutput[];
  timeoutMs?: number;
  idleTimeoutMs?: number;
  autoArchive: boolean;
  triggerContext: unknown;
  outputContext: unknown;
  hubConfig: unknown;
}): LaunchMachineIntent {
  return {
    kind: "launch_machine",
    organizationId: input.organizationId,
    projectId: input.projectId,
    triggerRunId: input.triggerRunId,
    triggerName: input.triggerName,
    environmentName: input.environmentName,
    environment: input.environment,
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.github === undefined ? {} : { github: input.github }),
    prompt: input.prompt,
    agent: input.agent,
    allowOutputs: input.allowOutputs,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: input.idleTimeoutMs }),
    autoArchive: input.autoArchive,
    triggerContext: input.triggerContext,
    outputContext: input.outputContext,
    configurationRevisionId: input.configurationRevisionId,
    hubConfig: input.hubConfig,
  };
}
