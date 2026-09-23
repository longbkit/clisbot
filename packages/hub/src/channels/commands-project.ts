import type {
  ChannelConversationSelectionRecord,
  ChannelConversationKey,
} from "../db/channel-access.js";
import type { ChannelStore } from "../db/channels.js";
import { deriveBindingKey, routeFingerprint, routePosition } from "./bindings/index.js";
import type { DaemonConnection } from "./daemon/client.js";
import type { DaemonProject } from "./daemon/types.js";
import { commandAccessRequest } from "./commands-context.js";
import type { LifecycleCommandContext } from "./commands-lifecycle.js";
import type { ChannelPlaneDeps } from "./plane/types.js";

export interface ProjectCommandDependencies {
  plane: ChannelPlaneDeps;
  daemon: DaemonConnection;
  store: ChannelStore;
  authorizeConfiguration(
    context: LifecycleCommandContext,
    target: Extract<LifecycleCommandContext["route"]["target"], { kind: "agent" }>,
  ): Promise<{ allowed: boolean; reason?: string }>;
}

export async function runProjectCommand(
  deps: ProjectCommandDependencies,
  value: string | undefined,
  context: LifecycleCommandContext,
): Promise<{ handled: boolean; detail: string }> {
  if (context.route.target.kind !== "agent") {
    return reply(context, "This command is not available on an automation route.");
  }
  const argument = value?.trim() ?? "";
  const key = selectionKey(deps.plane, context);
  if (/^clear$/iu.test(argument)) {
    await deps.store.access.setConversationSelection(key, {
      selectedProjectId: null,
      selectedProjectRoot: null,
      selectedRoutePosition: null,
      selectedRouteFingerprint: null,
      selectedDaemonReference: null,
      selectedBy: context.message.senderIdentity,
    });
    return reply(context, "Project routing cleared. The next session follows the Route default.");
  }
  const projects = await deps.daemon.listProjects();
  const accessible = await accessibleProjects(deps, context, projects, context.route.target);
  if (argument === "" || /^list$/iu.test(argument)) {
    const current = await deps.store.access.findConversationSelection(key);
    return reply(context, projectListText(accessible, selectedProject(accessible, current)));
  }
  const project = chooseProject(accessible, argument);
  if (project === undefined) {
    return reply(context, `Project not found or unavailable: ${argument}. Use /project list.`);
  }
  const target = {
    ...context.route.target,
    projectId: project.projectId,
    projectRoot: project.rootPath,
  };
  const configuration = await deps.authorizeConfiguration(context, target);
  if (!configuration.allowed) {
    return reply(context, configuration.reason ?? "Project configuration is unavailable.");
  }
  const accessTarget = deps.plane.resolveAgentAccessTarget(target);
  await deps.store.access.setConversationSelection(key, {
    selectedProjectId: project.projectId,
    selectedProjectRoot: project.rootPath,
    selectedRoutePosition: routePosition(context.account, context.route),
    selectedRouteFingerprint: routeFingerprint(context.route),
    selectedDaemonReference: accessTarget.daemonReference,
    selectedBy: context.message.senderIdentity,
  });
  return reply(
    context,
    `Project selected: ${project.name} (${project.projectId}). Use /new to start the next session there.`,
  );
}

async function accessibleProjects(
  deps: ProjectCommandDependencies,
  context: LifecycleCommandContext,
  projects: readonly DaemonProject[],
  routeTarget: Extract<LifecycleCommandContext["route"]["target"], { kind: "agent" }>,
): Promise<DaemonProject[]> {
  const checks = await Promise.all(
    projects.map(async (project) => {
      const target = deps.plane.resolveAgentAccessTarget({
        ...routeTarget,
        projectId: project.projectId,
        projectRoot: project.rootPath,
      });
      const decision = await deps.plane.commandAccess?.authorizeChannelPrivilege(
        commandAccessRequest(
          deps.plane,
          context.message,
          context.account,
          context.route,
          "agent.create",
          target,
        ),
      );
      if (decision?.allowed !== true) return undefined;
      const configuration = await deps.authorizeConfiguration(context, {
        ...routeTarget,
        projectId: project.projectId,
        projectRoot: project.rootPath,
      });
      return configuration.allowed ? project : undefined;
    }),
  );
  return checks.filter((project): project is DaemonProject => project !== undefined);
}
function chooseProject(
  projects: readonly DaemonProject[],
  argument: string,
): DaemonProject | undefined {
  const exactId = projects.find((project) => project.projectId === argument);
  if (exactId !== undefined) return exactId;
  const matches = projects.filter(
    (project) => project.name.toLocaleLowerCase() === argument.toLocaleLowerCase(),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function projectListText(
  projects: readonly DaemonProject[],
  selected: DaemonProject | undefined,
): string {
  const header = selected === undefined ? "Projects:" : `Selected Project: ${selected.name}`;
  if (projects.length === 0) return `${header}\nNo Projects are available on this Host.`;
  return `${header}\n${projects.map((project) => `- ${project.name} (${project.projectId})`).join("\n")}`;
}

function selectedProject(
  projects: readonly DaemonProject[],
  selection: ChannelConversationSelectionRecord | undefined,
): DaemonProject | undefined {
  const projectId = selection?.selectedProjectId;
  return projectId === null || projectId === undefined
    ? undefined
    : projects.find((project) => project.projectId === projectId);
}

function selectionKey(
  plane: ChannelPlaneDeps,
  context: LifecycleCommandContext,
): ChannelConversationKey {
  return {
    organizationId: plane.organizationId,
    channel: context.message.channel,
    accountId: context.account.accountId,
    ...deriveBindingKey(context.message, context.route),
  };
}

async function reply(
  context: LifecycleCommandContext,
  text: string,
): Promise<{ handled: boolean; detail: string }> {
  const delivered = await context.post(text);
  return { handled: delivered, detail: text };
}
