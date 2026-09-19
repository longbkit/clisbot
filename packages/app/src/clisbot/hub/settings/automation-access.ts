/**
 * Who may create, see, and run Automations, as the app decides it from the
 * Hub's answers (docs/features/access/scoped-admins.md, "Automations").
 * `HubAutomationSchema` in `contracts.ts` is the wire shape; the scoped fields
 * below are the ones this feature adds and will fold into it.
 */
import { z } from "zod";
import { HubAutomationSchema, type HubEffectiveAccessSchema } from "../contracts";

/** Admin manages this one Automation and who gets into it; Run only runs it and sees results. */
export const HubAutomationScopeSchema = z.enum(["admin", "run"]);
export type HubAutomationScope = z.infer<typeof HubAutomationScopeSchema>;

export const HubScopedAutomationSchema = HubAutomationSchema.extend({
  // COMPAT(automation-scope): added 2026-09-19; an older Hub omits these four fields.
  scope: HubAutomationScopeSchema.optional(),
  /** Why the Hub paused it (author lost access); null or absent while it runs normally. */
  pausedReason: z.string().nullable().optional(),
  author: z.object({ userId: z.string(), name: z.string() }).nullable().optional(),
  target: z
    .object({ daemonName: z.string().nullable(), projectName: z.string().nullable() })
    .optional(),
});
export type HubScopedAutomation = z.infer<typeof HubScopedAutomationSchema>;
export const HubScopedAutomationsSchema = z.object({
  automations: z.array(HubScopedAutomationSchema),
});

type EffectiveAccess = z.infer<typeof HubEffectiveAccessSchema>;

/** Work access to any Project: a Host or Project grant carrying `project.use`. */
export function canCreateAutomation(
  canManage: boolean,
  access: EffectiveAccess | undefined,
): boolean {
  if (canManage || access?.owner === true) return true;
  return (
    access?.grants.some(
      ({ resource, privileges }) =>
        (resource.kind === "daemon" || resource.kind === "project") &&
        resource.available &&
        privileges.includes("project.use"),
    ) === true
  );
}

/** Hosts the viewer can run work on, for narrowing the editor's Host choices. */
export function accessibleHostIds(access: EffectiveAccess | undefined): Set<string> | null {
  if (access === undefined || access.owner) return null;
  const hosts = new Set<string>();
  for (const { resource, privileges } of access.grants) {
    if (!privileges.includes("project.use")) continue;
    if (resource.kind === "daemon") hosts.add(resource.id);
    else if (resource.kind === "project" && resource.parent?.kind === "daemon") {
      hosts.add(resource.parent.id);
    }
  }
  return hosts;
}

/** What the signed-in viewer may do on this screen, from the Hub's scope and their own grants. */
export function automationViewerAccess<Daemon extends { id: string }>(input: {
  canManage: boolean;
  selected: Pick<HubScopedAutomation, "scope"> | null;
  access: EffectiveAccess | undefined;
  daemons: readonly Daemon[];
}) {
  const hostIds = accessibleHostIds(input.access);
  return {
    canCreate: canCreateAutomation(input.canManage, input.access),
    canEdit: input.canManage || input.selected?.scope === "admin",
    /** The Hub already scoped the list: a listed Automation is at least runnable. */
    canRun: input.selected?.scope !== undefined,
    visibleDaemons: input.daemons.filter(
      ({ id }) => input.canManage || hostIds === null || hostIds.has(id),
    ),
  };
}

export type AutomationListFilter = "mine" | "shared" | "all";

/** Mine: authored by the viewer. Shared with me: someone else's, granted to the viewer. */
export function filterAutomations<Automation extends Pick<HubScopedAutomation, "author">>(
  automations: readonly Automation[],
  filter: AutomationListFilter,
  viewerUserId: string | null,
): Automation[] {
  if (filter === "all") return [...automations];
  return automations.filter((automation) =>
    filter === "mine"
      ? automation.author?.userId === viewerUserId
      : automation.author?.userId !== viewerUserId,
  );
}

export function automationScopeLabel(scope: HubAutomationScope | undefined): string {
  return scope === "run" ? "Run" : "Admin";
}

/**
 * The warning beside a Run grant. Also shown on the Automation's own Access
 * section; the grant form (access-* files) can import it.
 */
export function automationRunWarning(
  automation: Pick<HubScopedAutomation, "author" | "target">,
): string {
  const author = automation.author?.name ?? "its author";
  const target = automation.target?.projectName ?? automation.target?.daemonName ?? "its Project";
  return `Runs with ${author}'s access on ${target}. The runner sees results but gets no Project access in the app.`;
}
