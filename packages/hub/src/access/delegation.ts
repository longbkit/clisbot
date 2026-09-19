import type { CompiledHubBundle } from "../config/bundle.js";
import {
  parseCompiledHubConfig,
  type CompiledAgent,
  type CompiledHubConfig,
} from "../config/compiler.js";
import type { Database } from "../db/types.js";
import type { OrganizationAccessValue } from "../auth/organization-access.js";
import type {
  ChannelControlPlane,
  CompiledChannelAccount,
  CompiledRoute,
  RouteTarget,
} from "../channels/config/compile.js";
import type { ApprovalRule } from "../channels/config/schema.js";
import { applyAgentControls, type AgentControls } from "../channels/config/agent-controls.js";
import { privilegeCovers } from "../channels/config/privileges.js";
import { APPROVAL_PRIVILEGES, type AccessPrivilege } from "./contract.js";
import { AccessPolicyError, type AccessStore, type DelegatedAgentExecution } from "./store.js";

export interface DelegationPrincipal {
  organizationId: string;
  userId: string;
  membershipId: string;
}

/** The signed-in Member as the principal a management write delegates for. */
export function delegationPrincipal(access: OrganizationAccessValue): DelegationPrincipal {
  return {
    organizationId: access.organization.id,
    userId: access.account.id,
    membershipId: access.membership.id,
  };
}

/** One Route of one Channel account: an index into its `routes`. */
export interface DelegatedRouteRef {
  channel: string;
  accountId: string;
  position: number;
}

/**
 * Authorizes the direct Agents and referenced Automations in one compiled
 * Channel candidate. A save of the whole configuration checks every Route.
 * A change to one Route (`/promoteroutedefault`) passes `routes`: the rest of
 * the candidate is byte-identical to the active revision, and was authorized
 * by whoever published it, so checking it against this principal would only
 * refuse a Connection manager for Routes they did not touch.
 */
export async function assertChannelConfigurationDelegation(input: {
  access: AccessStore;
  database: Database;
  principal: DelegationPrincipal;
  bundle: CompiledHubBundle;
  controlPlane: ChannelControlPlane;
  routes?: readonly DelegatedRouteRef[];
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
    agentControls: AgentControls | undefined,
  ): Promise<void> => {
    const requiredPrivileges = automaticApprovalPrivileges(approval, preapprovesChannelReply);
    if (target.kind === "agent") {
      const environment = environments.get(target.environment);
      const named = input.bundle.agents[target.agent];
      if (environment?.kind !== "daemon" || named === undefined) throw delegationDenied();
      // The Route's default controls are what the Route starts, so they are
      // what the publisher must be able to delegate.
      const agent = applyAgentControls(named, agentControls);
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

  const inScope = (account: { channel: string; accountId: string }, position: number) =>
    input.routes === undefined ||
    input.routes.some(
      (route) =>
        route.channel === account.channel &&
        route.accountId === account.accountId &&
        route.position === position,
    );
  for (const account of input.controlPlane.accounts) {
    for (const [position, route] of account.routes.entries()) {
      if (!inScope(account, position)) continue;
      await appendTarget(
        route.target,
        route.approval,
        route.defaults.outbound.path === "tool",
        route.defaults.agentControls,
      );
    }
  }

  await input.access.assertCanDelegateAgentExecutions({
    ...input.principal,
    executions,
  });
}

/**
 * The Routes of a candidate account a Connection Admin save must re-check:
 * those whose delegated parts (target, approvals, the tool reply path, Agent
 * controls) match no Route of the active account. Each active Route answers
 * for one candidate Route, so reordering or deleting Routes needs no check and
 * copying a Route the saver could not publish still does. An audience-only
 * edit changes none of these parts: who may talk is the Route Admin's to decide.
 */
export function routesNeedingDelegation(
  active: CompiledChannelAccount | undefined,
  candidate: CompiledChannelAccount,
): DelegatedRouteRef[] {
  const unmatched = (active?.routes ?? []).map(delegatedRouteParts);
  const refs: DelegatedRouteRef[] = [];
  for (const [position, route] of candidate.routes.entries()) {
    const at = unmatched.indexOf(delegatedRouteParts(route));
    if (at >= 0) {
      unmatched.splice(at, 1);
      continue;
    }
    refs.push({ channel: candidate.channel, accountId: candidate.accountId, position });
  }
  return refs;
}

/** What `assertChannelConfigurationDelegation` reads from one compiled Route. */
function delegatedRouteParts(route: CompiledRoute): string {
  return JSON.stringify([
    route.target,
    route.approval,
    route.defaults.outbound.path === "tool",
    route.defaults.agentControls ?? null,
  ]);
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
