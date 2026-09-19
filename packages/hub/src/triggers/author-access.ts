/**
 * An Automation runs with its author's access (docs/features/access/scoped-admins.md).
 * Every accepted run re-checks that the author can still delegate the targets
 * the active revision names, with the same check the save used. When they
 * cannot, the Hub pauses the Automation (`enabled = false` plus `pausedReason`),
 * records an `automation_paused` access event, and tells every Automation
 * Admin. Re-enabling is a save by an Admin, which runs the check again.
 */
import { and, eq } from "drizzle-orm";
import {
  assertAutomationConfigurationDelegation,
  type DelegationPrincipal,
} from "../access/delegation.js";
import { AccessPolicyError, type AccessStore } from "../access/store.js";
import { parseCompiledHubConfig, type CompiledHubConfig } from "../config/compiler.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import * as schema from "../db/schema.js";
import type { Database, OrganizationTriggerRevisionRecord } from "../db/types.js";
import { reportFailure } from "../failures/index.js";
import { AccessEventStore } from "../access/events.js";
import type { NotificationMailer } from "../invitations/index.js";
import { createAutomationPausedNotice, type AutomationPausedNotice } from "./paused-notice.js";

export interface WorkflowRunAuthorizationInput {
  organizationId: string;
  workflowId: string;
  configurationRevisionId: string;
}

export type WorkflowRunAuthorization = { allowed: true } | { allowed: false; reason: string };

export type AuthorizeWorkflowRun = (
  input: WorkflowRunAuthorizationInput,
) => Promise<WorkflowRunAuthorization>;

/** The pieces the check needs, each replaceable in tests. */
export interface AutomationAuthorAccessCheckDependencies {
  database: Database;
  /** The author's Member principal in the organization, or undefined when they left it. */
  resolveAuthor: (
    organizationId: string,
    userId: string,
  ) => Promise<DelegationPrincipal | undefined>;
  /** Throws `AccessPolicyError` when the principal cannot delegate the configuration. */
  assertDelegation: (
    principal: DelegationPrincipal,
    configuration: CompiledHubConfig,
  ) => Promise<void>;
  notifyPaused: AutomationPausedNotice;
}

export function createAutomationAuthorAccessCheck(
  deps: AutomationAuthorAccessCheckDependencies,
): AuthorizeWorkflowRun {
  return async (input) => {
    const revision = await deps.database.findOrganizationTriggerRevision(
      input.workflowId,
      input.configurationRevisionId,
    );
    // Project configurations and revisions without an author (imported from
    // GitHub, or older than the field) carry no Member to re-check.
    if (revision === undefined || revision.createdByUserId === null) return { allowed: true };
    const loss = await authorAccessLoss(deps, input.organizationId, revision);
    if (loss === undefined) return { allowed: true };
    await pauseAutomation(deps, input, revision, loss);
    return { allowed: false, reason: loss };
  };
}

async function authorAccessLoss(
  deps: AutomationAuthorAccessCheckDependencies,
  organizationId: string,
  revision: OrganizationTriggerRevisionRecord,
): Promise<string | undefined> {
  const principal = await deps.resolveAuthor(organizationId, revision.createdByUserId!);
  if (principal === undefined) return "its author is no longer a Member of the organization";
  try {
    await deps.assertDelegation(
      principal,
      parseCompiledHubConfig(revision.normalizedConfiguration),
    );
    return undefined;
  } catch (error) {
    if (error instanceof AccessPolicyError) {
      return "its author lost access to the Host, Project, or Agent configuration it runs on";
    }
    throw error;
  }
}

async function pauseAutomation(
  deps: AutomationAuthorAccessCheckDependencies,
  input: WorkflowRunAuthorizationInput,
  revision: OrganizationTriggerRevisionRecord,
  reason: string,
): Promise<void> {
  const paused = await deps.database.pauseOrganizationTrigger({
    organizationId: input.organizationId,
    triggerId: input.workflowId,
    reason,
  });
  // Undefined means another run paused it first; that run sent the notice.
  if (paused === undefined) return;
  await deps
    .notifyPaused({ automation: paused, authorUserId: revision.createdByUserId!, reason })
    .catch((error: unknown) => {
      reportFailure(error, {
        operation: "automation.paused.notify",
        component: "triggers",
        organizationId: input.organizationId,
      });
    });
}

/** The author's membership, looked up by user id: the revision stores the user, not the Member. */
export function createAuthorResolver(
  runtime: DatabaseRuntime,
): AutomationAuthorAccessCheckDependencies["resolveAuthor"] {
  return async (organizationId, userId) => {
    const [membership] = await runtime
      .drizzle()
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(
        and(eq(schema.members.organizationId, organizationId), eq(schema.members.userId, userId)),
      )
      .limit(1);
    return membership === undefined
      ? undefined
      : { organizationId, userId, membershipId: membership.id };
  };
}

export function createDelegationAssertion(
  access: AccessStore,
): AutomationAuthorAccessCheckDependencies["assertDelegation"] {
  return (principal, configuration) =>
    assertAutomationConfigurationDelegation({ access, principal, configuration });
}

/** The production check: real author lookup, real delegation rule, real notice. */
export function composeAutomationAuthorAccessCheck(deps: {
  database: Database;
  runtime: DatabaseRuntime;
  access: AccessStore;
  mailer: NotificationMailer | undefined;
}): AuthorizeWorkflowRun {
  return createAutomationAuthorAccessCheck({
    database: deps.database,
    resolveAuthor: createAuthorResolver(deps.runtime),
    assertDelegation: createDelegationAssertion(deps.access),
    notifyPaused: createAutomationPausedNotice({
      runtime: deps.runtime,
      access: deps.access,
      events: new AccessEventStore(deps.runtime),
      mailer: deps.mailer,
    }),
  });
}
