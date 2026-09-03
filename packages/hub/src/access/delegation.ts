import type { CompiledHubBundle } from "../config/bundle.js";
import {
  parseCompiledHubConfig,
  type CompiledAgent,
  type CompiledHubConfig,
} from "../config/compiler.js";
import type { Database } from "../db/types.js";
import type { ChannelControlPlane, RouteTarget } from "../channels/config/compile.js";
import type { ApprovalRule } from "../channels/config/schema.js";
import { privilegeCovers } from "../channels/config/privileges.js";
import { APPROVAL_PRIVILEGES, type AccessPrivilege } from "./contract.js";
import { AccessPolicyError, type AccessStore, type DelegatedAgentExecution } from "./store.js";

export interface DelegationPrincipal {
  organizationId: string;
  userId: string;
  membershipId: string;
}

/** Authorizes every direct Agent and referenced Automation in one compiled Channel candidate. */
export async function assertChannelConfigurationDelegation(input: {
  access: AccessStore;
  database: Database;
  principal: DelegationPrincipal;
  bundle: CompiledHubBundle;
  controlPlane: ChannelControlPlane;
}): Promise<void> {
  const executions: DelegatedAgentExecution[] = [];
  const environments = new Map(
    input.bundle.configuration.environments.map((environment) => [environment.name, environment]),
  );
  const automationConfigurations = new Map<string, Promise<CompiledHubConfig>>();

  const appendTarget = async (
    target: RouteTarget,
    approval: readonly ApprovalRule[],
    preapprovesChannelReply: boolean,
  ): Promise<void> => {
    const requiredPrivileges = automaticApprovalPrivileges(approval, preapprovesChannelReply);
    if (target.kind === "agent") {
      const environment = environments.get(target.environment);
      const agent = input.bundle.agents[target.agent];
      if (environment?.kind !== "daemon" || agent === undefined) throw delegationDenied();
      executions.push(
        executionFromAgent(
          environment.daemonId ?? environment.daemon,
          environment.projectId,
          environment.cwd,
          environment.worktree,
          agent,
          requiredPrivileges,
        ),
      );
      return;
    }

    let configuration = automationConfigurations.get(target.workflow);
    if (configuration === undefined) {
      configuration = loadActiveAutomationConfiguration(
        input.database,
        input.principal.organizationId,
        target.workflow,
      );
      automationConfigurations.set(target.workflow, configuration);
    }
    executions.push(...executionsFromConfiguration(await configuration, requiredPrivileges));
  };

  for (const account of input.controlPlane.accounts) {
    for (const route of account.routes) {
      await appendTarget(route.target, route.approval, route.defaults.outbound.path === "tool");
    }
    if (!account.fallback.deny && account.fallback.target !== undefined) {
      await appendTarget(
        account.fallback.target,
        account.fallback.approval ?? account.approval,
        account.defaults.outbound.path === "tool",
      );
    }
  }

  await input.access.assertCanDelegateAgentExecutions({
    ...input.principal,
    executions,
  });
}

/** Authorizes every possible Agent choice in one resolved Automation document. */
export function assertAutomationConfigurationDelegation(input: {
  access: AccessStore;
  principal: DelegationPrincipal;
  configuration: CompiledHubConfig;
}): Promise<void> {
  return input.access.assertCanDelegateAgentExecutions({
    ...input.principal,
    executions: executionsFromConfiguration(input.configuration, []),
  });
}

function executionsFromConfiguration(
  configuration: CompiledHubConfig,
  requiredPrivileges: readonly AccessPrivilege[],
): DelegatedAgentExecution[] {
  const environments = new Map(
    configuration.environments.map((environment) => [environment.name, environment]),
  );
  const executions: DelegatedAgentExecution[] = [];
  for (const trigger of configuration.triggers) {
    for (const step of trigger.steps) {
      const environment = environments.get(step.environment);
      if (environment?.kind !== "daemon") throw delegationDenied();
      const agents = "choices" in step.agent ? Object.values(step.agent.choices) : [step.agent];
      for (const agent of agents) {
        executions.push(
          executionFromAgent(
            environment.daemonId ?? environment.daemon,
            environment.projectId,
            environment.cwd,
            environment.worktree,
            agent,
            requiredPrivileges,
          ),
        );
      }
    }
  }
  return executions;
}

function executionFromAgent(
  daemonReference: string,
  projectId: string | undefined,
  cwd: string,
  worktree: Extract<CompiledHubConfig["environments"][number], { kind: "daemon" }>["worktree"],
  agent: CompiledAgent,
  requiredPrivileges: readonly AccessPrivilege[],
): DelegatedAgentExecution {
  return {
    daemonReference,
    ...(projectId === undefined ? {} : { projectId }),
    cwd,
    ...(worktree === undefined ? {} : { worktree }),
    providerId: agent.provider,
    ...(agent.model === undefined ? {} : { modelId: agent.model }),
    ...(agent.mode === undefined ? {} : { modeId: agent.mode }),
    ...(agent.thinkingOptionId === undefined ? {} : { thinkingOptionId: agent.thinkingOptionId }),
    fastMode: agent.featureValues?.["fast_mode"] === true,
    requiredPrivileges: uniquePrivileges([
      ...requiredPrivileges,
      ...(agent.featureValues?.["auto_accept"] === true ||
      agent.options?.["approval_policy"] === "never"
        ? APPROVAL_PRIVILEGES
        : []),
    ]),
  };
}

async function loadActiveAutomationConfiguration(
  database: Database,
  organizationId: string,
  name: string,
): Promise<CompiledHubConfig> {
  const automation = (await database.listOrganizationTriggers(organizationId)).find(
    (candidate) => candidate.enabled && candidate.name === name,
  );
  if (automation === undefined) throw delegationDenied();
  const revision = await database.findOrganizationTriggerRevision(
    automation.id,
    automation.activeRevisionId,
  );
  if (revision === undefined) throw delegationDenied();
  try {
    return parseCompiledHubConfig(revision.normalizedConfiguration);
  } catch {
    throw delegationDenied();
  }
}

function automaticApprovalPrivileges(
  rules: readonly ApprovalRule[],
  preapprovesChannelReply: boolean,
): AccessPrivilege[] {
  const required = new Set<AccessPrivilege>(preapprovesChannelReply ? APPROVAL_PRIVILEGES : []);
  for (const privilege of APPROVAL_PRIVILEGES) {
    const decision = rules.find(({ match }) =>
      privilegeCovers(normalizeApprovalMatch(match), privilege),
    );
    if (decision?.mode === "auto-allow") required.add(privilege);
  }
  return [...required];
}

function uniquePrivileges(privileges: readonly AccessPrivilege[]): AccessPrivilege[] {
  return [...new Set(privileges)];
}

function normalizeApprovalMatch(match: string): string {
  return match === "*" || match.startsWith("approval.") ? match : `approval.${match}`;
}

function delegationDenied(): AccessPolicyError {
  return new AccessPolicyError("access_denied", "Access denied");
}
