import type { AgentSessionConfig } from "../agent-sdk-types.js";
import { isFullAutoAcceptMode } from "../full-auto-accept.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { ClisbotToolInputError } from "./types.js";

/**
 * An agent's Clisbot tools never start or switch an agent into a configuration that runs without
 * approval prompts: Full auto-accept, a provider's no-prompt mode (Claude Bypass, Codex Full
 * access, Copilot Allow all, OMP Full access) or a provider's own `auto_accept`. An agent doing
 * so would approve its own calls, or a child's. A person turns these on, in Clisbot or on its
 * channel; their paths do not come through here.
 *
 * The provider judges what is unattended (`ProviderSnapshotManager.isUnattendedConfiguration`,
 * as Managed Access does), so this file knows no provider's mode ids. An agent tool is judged on
 * what it asks for, not on what its target already runs: a child still inherits its caller's
 * mode, and an agent can still change the model of a session a person put in Bypass.
 */
export const AGENT_UNATTENDED_REFUSAL =
  "An agent cannot turn on a mode that runs without approval prompts (Full auto-accept, Bypass, Full access, Allow all or auto-accept). Only a person can, in Clisbot or on its channel.";

export const AGENT_SCHEDULE_MODE_REQUIRED =
  "A schedule an agent creates needs a mode that asks for approval: pass `mode`. Without one, its runs start in the provider's no-prompt mode.";

type Judge = Pick<ProviderSnapshotManager, "isUnattendedConfiguration">;

export interface UnattendedRequest {
  modeId?: string | null;
  featureValues?: Record<string, unknown>;
}

export interface AgentLocation {
  provider: string;
  cwd: string;
}

export interface AgentUnattendedGuard {
  /** Refuses an agent asking a new agent at `target` for an unattended mode or features. */
  refuseCreate(target: AgentLocation, request: UnattendedRequest): Promise<void>;
  /** Refuses an agent asking an existing agent for an unattended mode or features. */
  refuseChange(agentId: string, request: UnattendedRequest): Promise<void>;
  /** Refuses an agent creating or changing a schedule whose runs would be unattended. */
  refuseScheduleRun(config: AgentLocation & UnattendedRequest): Promise<void>;
}

function asksForSomething(request: UnattendedRequest): boolean {
  return (
    (request.modeId !== undefined && request.modeId !== null) ||
    Object.keys(request.featureValues ?? {}).length > 0
  );
}

function toConfig(target: AgentLocation, request: UnattendedRequest): AgentSessionConfig {
  return {
    provider: target.provider,
    cwd: target.cwd,
    ...(request.modeId ? { modeId: request.modeId } : {}),
    ...(request.featureValues ? { featureValues: request.featureValues } : {}),
  };
}

export function createAgentUnattendedGuard(input: {
  callerAgentId: string | undefined;
  judge: Judge;
  locateAgent(agentId: string): Promise<AgentLocation | null>;
}): AgentUnattendedGuard {
  const { callerAgentId, judge } = input;
  async function refuseIfUnattended(config: AgentSessionConfig): Promise<void> {
    if (await judge.isUnattendedConfiguration(config)) {
      throw new ClisbotToolInputError(AGENT_UNATTENDED_REFUSAL);
    }
  }
  return {
    async refuseCreate(target, request) {
      if (!callerAgentId || !asksForSomething(request)) return;
      await refuseIfUnattended(toConfig(target, request));
    },
    async refuseChange(agentId, request) {
      if (!callerAgentId || !asksForSomething(request)) return;
      if (isFullAutoAcceptMode(request.modeId)) {
        throw new ClisbotToolInputError(AGENT_UNATTENDED_REFUSAL);
      }
      // An agent that does not exist fails on its own in the tool that names it.
      const target = await input.locateAgent(agentId);
      if (target) await refuseIfUnattended(toConfig(target, request));
    },
    async refuseScheduleRun(config) {
      if (!callerAgentId) return;
      // Schedule runs are unattended creates: with no mode they take the no-prompt mode.
      if (!config.modeId) throw new ClisbotToolInputError(AGENT_SCHEDULE_MODE_REQUIRED);
      await refuseIfUnattended(toConfig(config, config));
    },
  };
}
