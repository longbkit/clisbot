/**
 * Automations for the organization-scoped management contract:
 *   list      GET  /organizations/:id/automations
 *   runnable  GET  /organizations/:id/automations/runnable
 *   validate  POST /organizations/:id/automations/validate
 *   create    POST /organizations/:id/automations
 *   read      GET  /organizations/:id/automations/:automationId[/revisions|/activity|/runs/:runId]
 *   update    PUT  /organizations/:id/automations/:automationId
 *   run       POST /organizations/:id/automations/:automationId/runs
 *
 * Who may do what (docs/features/access/scoped-admins.md, "Automations"):
 * Organization Owners and Admins pass on their role. Anyone with work access
 * to a Project (`project.use` on a Host or Project) may create an Automation;
 * the delegation check (`access/delegation.ts`) keeps its targets and Agent
 * configurations within what they hold, and the creator becomes its Admin.
 * Admin (`hub.access.manage` on the Automation) reads, edits, enables, and
 * grants; Run (`automation.run`) reads results and runs. Members may author
 * manual and Channel inputs only: Connection-sourced inputs are
 * `automation_input_requires_admin`, `env` and GitHub authority are
 * `automation_secret_requires_admin`.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { RESOURCE_ACCESS_LEVELS } from "../access/contract.js";
import {
  assertAutomationConfigurationDelegation,
  delegationPrincipal,
} from "../access/delegation.js";
import type { AccessAssignmentRecord, AccessStore } from "../access/store.js";
import { ProductRequestError, type OrganizationAccessValue } from "../auth/organization-access.js";
import { assertAutomationRouteTargetKept } from "../channels/control-plane.js";
import type { ChannelSupervisor } from "../channels/supervisor/types.js";
import type { DatabaseRuntime } from "../db/runtime/index.js";
import type { Database, OrganizationTriggerRecord } from "../db/types.js";
import type { PublicOperations } from "../public-operations/index.js";
import { compileAutomationDocument } from "../triggers/configuration/workflow-document.js";
import { ManualInvocationInputSchema } from "../triggers/manual/provider.js";
import { OrganizationTriggerStore, type PreparedOrganizationTrigger } from "../triggers/store.js";
import { automationRunView } from "./automation-run.js";
import {
  automationActivityView,
  automationRevisionView,
  automationView,
  AutomationViewContext,
  runnableAutomationView,
  type AutomationScope,
} from "./automation-view.js";
import { parseBody, problem } from "./request.js";

const automationCandidateSchema = z.object({ yaml: z.string().min(1) }).strict();
const automationRequestSchema = automationCandidateSchema.extend({
  expectedRevisionId: z.string().uuid().nullable(),
});

/** Inputs a Member may author. Every other `on:` event reads a Connection an Organization Admin owns. */
const MEMBER_AUTHORABLE_EVENTS = new Set(["manual.run", "channel.message"]);

export interface AutomationsApiDependencies {
  database: Database;
  runtime: DatabaseRuntime;
  access: AccessStore;
  channelSupervisor: ChannelSupervisor | null;
  manualRuns: Pick<PublicOperations, "dispatchManualRun"> | null | undefined;
  requireMutation: (request: Request) => void;
}

/** A refusal of what a Member authored; `handle` turns it into a 422 problem. */
class AutomationAuthoringError extends Error {
  constructor(
    readonly code: "automation_input_requires_admin" | "automation_secret_requires_admin",
    message: string,
  ) {
    super(message);
    this.name = "AutomationAuthoringError";
  }
}

/** Every Automation, or the ones the viewer holds a grant on. */
type ViewerScopes = "all" | Map<string, AutomationScope>;

export class AutomationsApi {
  constructor(private readonly deps: AutomationsApiDependencies) {}

  async handle(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    try {
      return await this.route(request, requestId, access, segments);
    } catch (error) {
      if (error instanceof AutomationAuthoringError) {
        return problem(requestId, 422, error.code, error.message);
      }
      throw error;
    }
  }

  private async route(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
  ): Promise<Response> {
    const store = new OrganizationTriggerStore(this.deps.database, access.organization.id);
    const [, , , automationId, action] = segments;
    if (request.method === "GET" && segments.length === 3) {
      return this.listAutomations(access, store);
    }
    if (request.method === "GET" && segments.length === 4 && automationId === "runnable") {
      return this.listRunnableAutomations(access, store);
    }
    if (request.method === "POST" && segments.length === 4 && automationId === "validate") {
      await this.requireAuthoring(access);
      return this.validateAutomation(request, access, store);
    }
    if (request.method === "POST" && segments.length === 3) {
      this.deps.requireMutation(request);
      await this.requireAuthoring(access);
      return this.saveAutomation(request, access, undefined, store);
    }
    if (automationId === undefined || segments.length > 6) {
      return problem(requestId, 404, "not_found", "No management resource matches this path.");
    }
    if (request.method === "POST" && segments.length === 5 && action === "runs") {
      this.deps.requireMutation(request);
      return this.runAutomation(request, requestId, access, automationId, store);
    }
    if (request.method === "PUT" && segments.length === 4) {
      this.deps.requireMutation(request);
      await this.requireScope(access, automationId, "admin");
      return this.saveAutomation(request, access, automationId, store);
    }
    if (request.method !== "GET") {
      return problem(
        requestId,
        405,
        "method_not_allowed",
        "Use GET, POST, PUT, or POST to the validate resource for Automations.",
      );
    }
    return this.readAutomation(requestId, access, segments, store);
  }

  private async listAutomations(
    access: OrganizationAccessValue,
    store: OrganizationTriggerStore,
  ): Promise<Response> {
    const scopes = await this.viewerScopes(access);
    const context = this.viewContext(access);
    const automations = await Promise.all(
      (await store.list()).flatMap((automation) => {
        const scope = scopeOf(scopes, automation.id);
        return scope === undefined ? [] : [automationView(context, store, automation, scope)];
      }),
    );
    return Response.json({ automations });
  }

  private async listRunnableAutomations(
    access: OrganizationAccessValue,
    store: OrganizationTriggerStore,
  ): Promise<Response> {
    const scopes = await this.viewerScopes(access);
    const projections = await Promise.all(
      (await store.list())
        .filter(({ id, enabled }) => enabled && scopeOf(scopes, id) !== undefined)
        .map(async (automation) =>
          runnableAutomationView(await store.activeRevision(automation), automation),
        ),
    );
    return Response.json({ automations: projections.filter((view) => view !== null) });
  }

  private async readAutomation(
    requestId: string,
    access: OrganizationAccessValue,
    segments: readonly string[],
    store: OrganizationTriggerStore,
  ): Promise<Response> {
    const [, , , automationId, action, runId] = segments;
    const scope = await this.requireScope(access, automationId!, "run");
    const automation = (await store.list()).find(({ id }) => id === automationId);
    if (automation === undefined) {
      return problem(requestId, 404, "automation_unavailable", "Automation is unavailable.");
    }
    if (segments.length === 4) {
      return Response.json(
        await automationView(this.viewContext(access), store, automation, scope),
      );
    }
    if (segments.length === 5 && action === "revisions") {
      if (scope !== "admin") throw new ProductRequestError(403, "forbidden");
      const revisions = await this.deps.database.listOrganizationTriggerRevisions(
        access.organization.id,
        automation.id,
        50,
      );
      return Response.json({ revisions: revisions.map(automationRevisionView) });
    }
    if (segments.length === 5 && action === "activity") {
      const activity = await this.deps.database.listWorkflowActivityRuns(automation.id, 100);
      return Response.json({ activity: automationActivityView(activity) });
    }
    if (segments.length === 6 && action === "runs") {
      if (runId === undefined || !z.string().uuid().safeParse(runId).success) {
        return problem(requestId, 404, "run_unavailable", "Run is unavailable.");
      }
      const run = await automationRunView(
        this.deps.database,
        access.organization.id,
        automation.id,
        runId,
      );
      return run === undefined
        ? problem(requestId, 404, "run_unavailable", "Run is unavailable.")
        : Response.json(run);
    }
    return problem(requestId, 404, "not_found", "No management resource matches this path.");
  }

  private async validateAutomation(
    request: Request,
    access: OrganizationAccessValue,
    store: OrganizationTriggerStore,
  ): Promise<Response> {
    const input = await parseBody(request, automationCandidateSchema);
    if (!access.capabilities.manageResources) assertMemberAuthorable(input.yaml);
    const prepared = await store.validate(input.yaml);
    return Response.json({
      valid: true,
      name: prepared.compiled.authored.name,
      definition: prepared.compiled.authored,
    });
  }

  private async saveAutomation(
    request: Request,
    access: OrganizationAccessValue,
    automationId: string | undefined,
    store: OrganizationTriggerStore,
  ): Promise<Response> {
    const input = await parseBody(request, automationRequestSchema);
    if (!access.capabilities.manageResources) assertMemberAuthorable(input.yaml);
    const isUpdate = automationId !== undefined;
    const automation = await store.save(
      {
        ...(isUpdate ? { triggerId: automationId } : {}),
        yaml: input.yaml,
        userId: access.account.id,
        expectedActiveRevisionId: input.expectedRevisionId,
      },
      { authorize: (prepared) => this.authorizeSave(access, automationId, prepared) },
    );
    if (!isUpdate && !access.capabilities.manageResources) {
      await this.grantCreatorAdmin(access, automation);
    }
    await this.deps.channelSupervisor?.reconcile();
    return Response.json(
      await automationView(this.viewContext(access), store, automation, "admin"),
      {
        status: isUpdate ? 200 : 201,
      },
    );
  }

  private async authorizeSave(
    access: OrganizationAccessValue,
    automationId: string | undefined,
    { compiled, resolved }: PreparedOrganizationTrigger,
  ): Promise<void> {
    await assertAutomationConfigurationDelegation({
      access: this.deps.access,
      principal: delegationPrincipal(access),
      configuration: resolved.configuration,
    });
    if (automationId !== undefined) {
      await assertAutomationRouteTargetKept({
        database: this.deps.database,
        organizationId: access.organization.id,
        automationId,
        candidate: compiled,
      });
    }
  }

  /** The creator administers what they created; Organization Admins already do. */
  private grantCreatorAdmin(
    access: OrganizationAccessValue,
    automation: OrganizationTriggerRecord,
  ): Promise<unknown> {
    return this.deps.access.saveAssignments(
      access.organization.id,
      [
        {
          subjectKind: "member",
          subjectId: access.membership.id,
          resourceKind: "automation",
          resourceId: automation.id,
          privileges: [...RESOURCE_ACCESS_LEVELS.automation.admin],
          constraints: {},
        },
      ],
      access.account.id,
    );
  }

  private async runAutomation(
    request: Request,
    requestId: string,
    access: OrganizationAccessValue,
    automationId: string,
    store: OrganizationTriggerStore,
  ): Promise<Response> {
    const scopes = await this.viewerScopes(access);
    const automation = (await store.list()).find(({ id }) => id === automationId);
    if (automation === undefined || scopeOf(scopes, automation.id) === undefined) {
      return problem(requestId, 404, "automation_unavailable", "Automation is unavailable.");
    }
    if (this.deps.manualRuns === null || this.deps.manualRuns === undefined) {
      return problem(
        requestId,
        503,
        "automation_runtime_unavailable",
        "Automation runtime is unavailable.",
      );
    }
    const input = await parseBody(request, ManualInvocationInputSchema);
    const result = await this.deps.manualRuns.dispatchManualRun(
      {
        kind: "member",
        membershipId: access.membership.id,
        organizationId: access.organization.id,
      },
      {
        expectedVersionId: automation.activeRevisionId,
        trigger: automation.name,
        actor: access.account.id,
        deliveryKey: randomUUID(),
        input,
      },
    );
    return Response.json(result);
  }

  /** Creating needs work access to some Project; the delegation check names which. */
  private async requireAuthoring(access: OrganizationAccessValue): Promise<void> {
    if (access.capabilities.manageResources) return;
    const assignments = await this.memberAssignments(access);
    const holdsProjectUse = assignments.some(
      ({ resourceKind, privileges }) =>
        (resourceKind === "daemon" || resourceKind === "project") &&
        privileges.includes("project.use"),
    );
    if (!holdsProjectUse) throw new ProductRequestError(403, "forbidden");
  }

  private async requireScope(
    access: OrganizationAccessValue,
    automationId: string,
    atLeast: AutomationScope,
  ): Promise<AutomationScope> {
    const scope = scopeOf(await this.viewerScopes(access), automationId);
    if (scope === undefined || (atLeast === "admin" && scope !== "admin")) {
      throw new ProductRequestError(403, "forbidden");
    }
    return scope;
  }

  private async viewerScopes(access: OrganizationAccessValue): Promise<ViewerScopes> {
    if (access.capabilities.manageResources) return "all";
    const scopes = new Map<string, AutomationScope>();
    for (const row of await this.memberAssignments(access)) {
      if (row.resourceKind !== "automation") continue;
      if (row.privileges.includes("hub.access.manage")) scopes.set(row.resourceId, "admin");
      else if (row.privileges.includes("automation.run") && !scopes.has(row.resourceId)) {
        scopes.set(row.resourceId, "run");
      }
    }
    return scopes;
  }

  private memberAssignments(access: OrganizationAccessValue): Promise<AccessAssignmentRecord[]> {
    return this.deps.access.listMemberAssignments(access.organization.id, {
      membershipId: access.membership.id,
      userId: access.account.id,
    });
  }

  private viewContext(access: OrganizationAccessValue): AutomationViewContext {
    return new AutomationViewContext(this.deps, access.organization.id);
  }
}

function scopeOf(scopes: ViewerScopes, automationId: string): AutomationScope | undefined {
  return scopes === "all" ? "admin" : scopes.get(automationId);
}

/**
 * What a Member may author: manual and Channel inputs, no secrets, no GitHub
 * authority. Reads the compiled document before Connections resolve, so the
 * answer names the rule rather than whether the Connection exists.
 */
function assertMemberAuthorable(yaml: string): void {
  for (const trigger of compileAutomationDocument(yaml).events) {
    if (!MEMBER_AUTHORABLE_EVENTS.has(trigger.on)) {
      throw new AutomationAuthoringError(
        "automation_input_requires_admin",
        `Input ${trigger.on} reads a Connection; only an Organization Admin can add it.`,
      );
    }
    for (const step of trigger.steps) {
      if (step.env !== undefined || step.github !== undefined) {
        throw new AutomationAuthoringError(
          "automation_secret_requires_admin",
          "Environment variables and GitHub authority come only from an Organization Admin.",
        );
      }
    }
  }
}
