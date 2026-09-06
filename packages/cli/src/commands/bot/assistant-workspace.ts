import type { CommandError } from "../../output/index.js";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  WorkspaceDescriptorPayload,
  WorkspaceCreateResponse,
  AgentSnapshotPayload,
} from "@getpaseo/protocol/messages";
import type { AssistantPlan } from "./plan.js";
import type { BotStartDeps, BotWorkspaceSource, BotAgentCreateOptions } from "./run.js";
import { isOnboardingEnabled } from "./onboarding-client.js";

export async function findAssistantWorkspace(
  client: DaemonClient,
  match: (workspace: WorkspaceDescriptorPayload) => boolean,
) {
  let cursor: string | undefined;
  do {
    const page = await client.fetchWorkspaces({
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    const workspace = page.entries.find(match);
    if (workspace) return workspace;
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return undefined;
}

/** Provisioning is shared by channel onboarding and an assistant without channels. */
export async function provisionAssistant(
  client: DaemonClient,
  deps: BotStartDeps,
  plan: AssistantPlan,
  env: NodeJS.ProcessEnv,
) {
  if (!(await deps.providerKnown(client, plan.provider))) {
    throw new Error(
      `Provider "${plan.provider}" is unavailable. Configure it on this daemon before onboarding.`,
    );
  }
  if (plan.isolation !== "worktree") await deps.ensureWorkspaceDir(plan.workspacePath);
  const source =
    plan.isolation === "worktree"
      ? { kind: "worktree" as const, cwd: plan.workspacePath }
      : { kind: "directory" as const, path: plan.workspacePath };
  const workspace = await deps.createWorkspace(client, source, plan.name);
  const directory = workspace.directory ?? plan.workspacePath;
  const template = isOnboardingEnabled(env)
    ? await deps.seedTemplate(directory, plan.botType, plan.overwriteTemplate)
    : undefined;
  const agent = await deps.createIdleAgent(client, {
    provider: plan.provider,
    ...(plan.model ? { model: plan.model } : {}),
    ...(plan.mode ? { modeId: plan.mode } : {}),
    cwd: directory,
    workspaceId: workspace.id,
    title: plan.agentTitle,
    assistantName: plan.name,
  });
  return {
    agentId: agent.id,
    agentTitle: plan.agentTitle,
    workspacePath: directory,
    workspaceId: workspace.id,
    projectId: workspace.projectId,
    ...(template ? { template } : {}),
  };
}

/** Discovery can return a loading snapshot while the provider process is starting. */
export async function waitForAssistantProvider(
  client: DaemonClient,
  provider: string,
): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  do {
    const entry = (await client.getProvidersSnapshot()).entries.find(
      (candidate) => candidate.provider === provider,
    );
    if (!entry || !entry.enabled) return false;
    if (entry.status === "ready") return true;
    if (entry.status !== "loading") return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error(
    `Provider "${provider}" discovery is still pending. Check provider status and rerun onboarding.`,
  );
}

export async function createAssistantWorkspace(
  client: DaemonClient,
  source: BotWorkspaceSource,
  title?: string,
) {
  if (source.kind === "directory") {
    const existing = await findAssistantWorkspace(
      client,
      (entry) => entry.workspaceDirectory === source.path,
    );
    if (existing)
      return {
        id: existing.id,
        projectId: existing.projectId,
        directory: existing.workspaceDirectory,
      };
  }
  const payload: WorkspaceCreateResponse["payload"] = await client.createWorkspace({
    source: source as Parameters<DaemonClient["createWorkspace"]>[0]["source"],
    ...(title === undefined ? {} : { title }),
  });
  if (!payload.workspace) {
    throw {
      code: "WORKSPACE_CREATE_FAILED",
      message: payload.error ?? "Workspace creation failed",
    } satisfies CommandError;
  }
  return {
    id: payload.workspace.id,
    projectId: payload.workspace.projectId,
    directory: payload.workspace.workspaceDirectory,
  };
}

export async function createAssistantAgent(client: DaemonClient, options: BotAgentCreateOptions) {
  const labels: Record<string, string> = options.assistantName
    ? { "clisbot.assistant": options.assistantName }
    : {};
  if (options.assistantName) {
    let cursor: string | undefined;
    do {
      const page = await client.fetchAgents({
        filter: { labels },
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
      });
      const existing = page.entries.find(
        ({ agent }) =>
          agent.workspaceId === options.workspaceId &&
          agent.provider === options.provider &&
          !agent.archivedAt &&
          (!options.model || agent.model === options.model) &&
          (!options.modeId || agent.currentModeId === options.modeId),
      );
      if (existing) return { id: existing.agent.id };
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
  }
  const agent: AgentSnapshotPayload = await client.createAgent({
    provider: options.provider,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.modeId === undefined ? {} : { modeId: options.modeId }),
    cwd: options.cwd,
    workspaceId: options.workspaceId,
    title: options.title,
    labels,
  });
  return { id: agent.id };
}
