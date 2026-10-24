import type { Logger } from "pino";
import { basename } from "node:path";
import {
  type FirstAgentContext,
  type SessionInboundMessage,
  type SessionOutboundMessage,
  type WorkspaceSetupSnapshot,
  type WorkspaceDescriptorPayload,
} from "./messages.js";
import type { PersistedWorkspaceRecord } from "./workspace-registry.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";
import {
  runWorktreeAutoTerminals,
  applyWorktreeSetupProgressEvent,
  buildWorktreeSetupDetail,
  createWorktreeSetupProgressAccumulator,
  getWorktreeSetupProgressResults,
} from "./worktree-bootstrap.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type { ServiceProxySubsystem } from "./service-proxy.js";
import type { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
import {
  getWorktreeSetupCommands,
  resolveWorktreeRuntimeEnv,
  runWorktreeSetupCommands,
  type WorktreeConfig,
  type WorktreeSetupCommandResult,
  WorktreeSetupError,
} from "../utils/worktree.js";
import { toCheckoutError } from "./checkout-git-utils.js";
import type {
  CreateClisbotWorktreeInput,
  CreateClisbotWorktreeResult,
} from "./clisbot-worktree-service.js";
import type { ArchiveDependencies } from "./workspace-archive-service.js";
import { toWorktreeWireError } from "./worktree-errors.js";
import {
  archiveCommand,
  createClisbotWorktreeCommand,
  listClisbotWorktreesCommand,
} from "./worktree/commands.js";
import type { WorkspaceSetupOperation } from "./workspace-setup-runtime.js";
import {
  formatWorkspaceAutomationBlockedMessage,
  WorkspaceAutomationBlockedError,
} from "./workspace-automation-gate.js";

const SAFE_GIT_REF_PATTERN = /^[A-Za-z0-9._/-]+$/;

type EmitSessionMessage = (message: SessionOutboundMessage) => void;

interface CreateClisbotWorktreeInBackgroundDependencies {
  clisbotHome?: string;
  worktreesRoot?: string;
  emitWorkspaceUpdateForWorkspaceId: (workspaceId: string) => Promise<void>;
  cacheWorkspaceSetupSnapshot: (workspaceId: string, snapshot: WorkspaceSetupSnapshot) => void;
  emit: EmitSessionMessage;
  sessionLogger: Logger;
  terminalManager: TerminalManager | null;
  serviceProxy: ServiceProxySubsystem | null;
  scriptRuntimeStore: WorkspaceScriptRuntimeStore | null;
  getDaemonTcpPort: (() => number | null) | null;
  getDaemonTcpHost: (() => string | null) | null;
  serviceProxyPublicBaseUrl?: string | null;
  onScriptsChanged: ((workspaceId: string, workspaceDirectory: string) => void) | null;
}

interface CreateClisbotWorktreeWorkflowDependencies extends CreateClisbotWorktreeInBackgroundDependencies {
  createClisbotWorktree: (
    input: CreateClisbotWorktreeInput,
    options?: {
      resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
    },
  ) => Promise<CreateClisbotWorktreeResult>;
  warmWorkspaceGitData: (workspace: PersistedWorkspaceRecord) => Promise<void>;
  autoNameWorkspaceBranchForFirstAgent: (input: {
    workspace: PersistedWorkspaceRecord;
    firstAgentContext: FirstAgentContext;
  }) => void;
  startWorkspaceSetup?: (workspaceId: string, operation: WorkspaceSetupOperation) => void;
  assertWorkspaceAutomationAllowed?: (workspaceId: string) => Promise<void>;
}

export type CreateClisbotWorktreeWorkflowResult = CreateClisbotWorktreeResult;

export type CreateClisbotWorktreeWorkflowFn = (
  input: CreateClisbotWorktreeInput,
  options?: {
    resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
  },
) => Promise<CreateClisbotWorktreeWorkflowResult>;

interface HandleWorkspaceSetupStatusRequestDependencies {
  emit: EmitSessionMessage;
  workspaceSetupSnapshots: Pick<ReadonlyMap<string, WorkspaceSetupSnapshot>, "get">;
  getWorkspace: (workspaceId: string) => Promise<PersistedWorkspaceRecord | null>;
}

interface HandleWorkspaceSetupRunRequestDependencies extends CreateClisbotWorktreeInBackgroundDependencies {
  getWorkspace: (workspaceId: string) => Promise<PersistedWorkspaceRecord | null>;
  clearAutomationBlock: (workspaceId: string) => Promise<boolean>;
  startWorkspaceSetup: (workspaceId: string, operation: WorkspaceSetupOperation) => void;
}

interface HandleCreateClisbotWorktreeRequestDependencies {
  clisbotHome?: string;
  worktreesRoot?: string;
  describeWorkspaceRecord: (
    result: CreateClisbotWorktreeResult,
  ) => Promise<WorkspaceDescriptorPayload>;
  emit: EmitSessionMessage;
  sessionLogger: Logger;
  createClisbotWorktreeWorkflow: (
    input: CreateClisbotWorktreeInput,
  ) => Promise<CreateClisbotWorktreeWorkflowResult>;
}

function normalizeFirstAgentContext(
  request: Extract<SessionInboundMessage, { type: "create_clisbot_worktree_request" }>,
): FirstAgentContext | undefined {
  if (request.firstAgentContext) {
    return request.firstAgentContext;
  }

  if (request.attachments || request.nameContext) {
    return {
      attachments: request.attachments ?? [],
      ...(request.nameContext ? { prompt: request.nameContext } : {}),
    };
  }

  return undefined;
}

export function assertSafeGitRef(ref: string, label: string): void {
  if (!SAFE_GIT_REF_PATTERN.test(ref) || ref.includes("..") || ref.includes("@{")) {
    throw new Error(`Invalid ${label}: ${ref}`);
  }
}

export async function handleClisbotWorktreeListRequest(
  dependencies: {
    emit: EmitSessionMessage;
    clisbotHome?: string;
    workspaceGitService: WorkspaceGitService;
  },
  msg: Extract<SessionInboundMessage, { type: "clisbot_worktree_list_request" }>,
): Promise<void> {
  const { requestId } = msg;
  const cwd = msg.repoRoot ?? msg.cwd;
  if (!cwd) {
    dependencies.emit({
      type: "clisbot_worktree_list_response",
      payload: {
        worktrees: [],
        error: { code: "UNKNOWN", message: "cwd or repoRoot is required" },
        requestId,
      },
    });
    return;
  }

  try {
    const worktrees = await listClisbotWorktreesCommand(
      { workspaceGitService: dependencies.workspaceGitService },
      { cwd },
    );
    dependencies.emit({
      type: "clisbot_worktree_list_response",
      payload: {
        worktrees: worktrees.map((entry) => ({
          worktreePath: entry.path,
          createdAt: entry.createdAt,
          branchName: entry.branchName ?? null,
          head: entry.head ?? null,
        })),
        error: null,
        requestId,
      },
    });
  } catch (error) {
    dependencies.emit({
      type: "clisbot_worktree_list_response",
      payload: {
        worktrees: [],
        error: toCheckoutError(error),
        requestId,
      },
    });
  }
}

export async function handleClisbotWorktreeArchiveRequest(
  dependencies: Omit<
    ArchiveDependencies,
    "emitWorkspaceUpdatesForWorkspaceIds" | "workspaceGitService"
  > & {
    emit: EmitSessionMessage;
    workspaceGitService: Pick<
      WorkspaceGitService,
      "getSnapshot" | "listWorktrees" | "invalidateWorktrees"
    >;
    emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds: Iterable<string>) => Promise<void>;
  },
  msg: Extract<SessionInboundMessage, { type: "clisbot_worktree_archive_request" }>,
): Promise<void> {
  const { requestId } = msg;

  try {
    const result = await archiveCommand(dependencies, {
      requestId,
      worktreePath: msg.worktreePath,
      repoRoot: msg.repoRoot,
      branchName: msg.branchName,
      workspaceId: msg.workspaceId,
      scope: msg.scope,
    });
    if (!result.ok) {
      dependencies.emit({
        type: "clisbot_worktree_archive_response",
        payload: {
          success: false,
          removedAgents: result.removedAgents,
          error: {
            code: result.code,
            message: result.message,
          },
          requestId,
        },
      });
      return;
    }

    dependencies.emit({
      type: "clisbot_worktree_archive_response",
      payload: {
        success: true,
        removedAgents: result.removedAgents,
        error: null,
        requestId,
      },
    });
  } catch (error) {
    dependencies.emit({
      type: "clisbot_worktree_archive_response",
      payload: {
        success: false,
        removedAgents: [],
        error: toCheckoutError(error),
        requestId,
      },
    });
  }
}

export async function handleCreateClisbotWorktreeRequest(
  dependencies: HandleCreateClisbotWorktreeRequestDependencies,
  request: Extract<SessionInboundMessage, { type: "create_clisbot_worktree_request" }>,
): Promise<void> {
  try {
    const commandResult = await createClisbotWorktreeCommand(
      {
        clisbotHome: dependencies.clisbotHome,
        worktreesRoot: dependencies.worktreesRoot,
        createClisbotWorktreeWorkflow: dependencies.createClisbotWorktreeWorkflow,
      },
      {
        cwd: request.cwd,
        projectId: request.projectId,
        worktreeSlug: request.worktreeSlug,
        firstAgentContext: normalizeFirstAgentContext(request),
        refName: request.refName,
        action: request.action,
        checkoutSource: request.checkoutSource,
        githubPrNumber: request.githubPrNumber,
      },
    );

    if (!commandResult.ok) {
      dependencies.sessionLogger.error(
        { err: commandResult.cause, cwd: request.cwd, worktreeSlug: request.worktreeSlug },
        "Failed to create worktree",
      );
      dependencies.emit({
        type: "create_clisbot_worktree_response",
        payload: {
          workspace: null,
          error: commandResult.error.message,
          errorCode: commandResult.error.code,
          setupTerminalId: null,
          requestId: request.requestId,
        },
      });
      return;
    }

    const createdWorktree = commandResult.createdWorktree;
    const descriptor = await dependencies.describeWorkspaceRecord(createdWorktree);
    dependencies.emit({
      type: "create_clisbot_worktree_response",
      payload: {
        workspace: descriptor,
        error: null,
        setupTerminalId: null,
        ...(createdWorktree.workspace.untrustedSource
          ? {
              setupSkippedReason: formatWorkspaceAutomationBlockedMessage(
                createdWorktree.workspace.untrustedSource,
              ),
            }
          : {}),
        requestId: request.requestId,
      },
    });
    dependencies.emit({
      type: "workspace_update",
      payload: {
        kind: "upsert",
        workspace: descriptor,
      },
    });
  } catch (error) {
    const wireError = toWorktreeWireError(error);
    dependencies.sessionLogger.error(
      { err: error, cwd: request.cwd, worktreeSlug: request.worktreeSlug },
      "Failed to create worktree",
    );
    dependencies.emit({
      type: "create_clisbot_worktree_response",
      payload: {
        workspace: null,
        error: wireError.message,
        errorCode: wireError.code,
        setupTerminalId: null,
        requestId: request.requestId,
      },
    });
  }
}

export async function createClisbotWorktreeWorkflow(
  dependencies: CreateClisbotWorktreeWorkflowDependencies,
  input: CreateClisbotWorktreeInput,
  options?: {
    resolveDefaultBranch?: (repoRoot: string) => Promise<string>;
  },
): Promise<CreateClisbotWorktreeWorkflowResult> {
  const createdWorktree = await dependencies.createClisbotWorktree(
    {
      ...input,

      clisbotHome: input.clisbotHome ?? dependencies.clisbotHome,
      worktreesRoot: input.worktreesRoot ?? dependencies.worktreesRoot,
    },
    options?.resolveDefaultBranch
      ? { resolveDefaultBranch: options.resolveDefaultBranch }
      : undefined,
  );
  const slug = basename(createdWorktree.worktree.worktreePath);
  const workspace = createdWorktree.workspace;

  try {
    await dependencies.assertWorkspaceAutomationAllowed?.(workspace.workspaceId);
  } catch (error) {
    if (!(error instanceof WorkspaceAutomationBlockedError)) throw error;
    const snapshot: WorkspaceSetupSnapshot = {
      status: "blocked",
      detail: buildWorktreeSetupDetail({ worktree: createdWorktree.worktree, results: [] }),
      error: null,
      blockedSource: error.source,
    };
    dependencies.cacheWorkspaceSetupSnapshot(workspace.workspaceId, snapshot);
    dependencies.emit({
      type: "workspace_setup_progress",
      payload: { workspaceId: workspace.workspaceId, ...snapshot },
    });
    return createdWorktree;
  }

  setTimeout(() => {
    if (input.firstAgentContext) {
      dependencies.autoNameWorkspaceBranchForFirstAgent({
        workspace,
        firstAgentContext: input.firstAgentContext,
      });
    }
    void dependencies.warmWorkspaceGitData(workspace).catch((error) => {
      dependencies.sessionLogger.warn(
        { err: error, workspaceId: workspace.workspaceId },
        "Failed to warm workspace git data after creating worktree",
      );
    });
    const runSetup = (signal: AbortSignal) =>
      runWorktreeSetupInBackground(
        dependencies,
        {
          requestCwd: input.cwd,
          repoRoot: createdWorktree.repoRoot,
          workspaceId: workspace.workspaceId,
          worktree: createdWorktree.worktree,
          shouldBootstrap: createdWorktree.created,
          slug,
          worktreePath: createdWorktree.worktree.worktreePath,
          workspaceCwd: workspace.cwd,
        },
        signal,
      );
    if (dependencies.startWorkspaceSetup) {
      dependencies.startWorkspaceSetup(workspace.workspaceId, runSetup);
    } else {
      void runSetup(new AbortController().signal);
    }
  }, 0);

  return createdWorktree;
}

export async function handleWorkspaceSetupStatusRequest(
  dependencies: HandleWorkspaceSetupStatusRequestDependencies,
  request: Extract<SessionInboundMessage, { type: "workspace_setup_status_request" }>,
): Promise<void> {
  const workspaceId = request.workspaceId;
  let snapshot = dependencies.workspaceSetupSnapshots.get(workspaceId) ?? null;
  if (!snapshot) {
    const workspace = await dependencies.getWorkspace(workspaceId);
    if (workspace?.untrustedSource) {
      snapshot = {
        status: "blocked",
        detail: buildWorktreeSetupDetail({
          worktree: {
            worktreePath: workspace.worktreeRoot ?? workspace.cwd,
            branchName: workspace.branch ?? "",
          },
          results: [],
        }),
        error: null,
        blockedSource: workspace.untrustedSource,
      };
    }
  }

  dependencies.emit({
    type: "workspace_setup_status_response",
    payload: {
      requestId: request.requestId,
      workspaceId,
      snapshot,
    },
  });
}

export async function handleWorkspaceSetupRunRequest(
  dependencies: HandleWorkspaceSetupRunRequestDependencies,
  request: Extract<SessionInboundMessage, { type: "workspace.setup.run.request" }>,
): Promise<void> {
  try {
    const workspace = await dependencies.getWorkspace(request.workspaceId);
    if (!workspace || workspace.archivedAt) {
      throw new Error(`Workspace not found: ${request.workspaceId}`);
    }
    const started = await dependencies.clearAutomationBlock(request.workspaceId);
    if (started) {
      const worktree: WorktreeConfig = {
        worktreePath: workspace.worktreeRoot ?? workspace.cwd,
        branchName: workspace.branch ?? "",
      };
      dependencies.startWorkspaceSetup(request.workspaceId, (signal) =>
        runWorktreeSetupInBackground(
          dependencies,
          {
            requestCwd: workspace.cwd,
            repoRoot: workspace.mainRepoRoot ?? workspace.cwd,
            workspaceId: workspace.workspaceId,
            worktree,
            shouldBootstrap: true,
            slug: basename(worktree.worktreePath),
            worktreePath: worktree.worktreePath,
            workspaceCwd: workspace.cwd,
          },
          signal,
        ),
      );
      await dependencies.emitWorkspaceUpdateForWorkspaceId(request.workspaceId);
    }
    dependencies.emit({
      type: "workspace.setup.run.response",
      payload: {
        requestId: request.requestId,
        workspaceId: request.workspaceId,
        started,
        error: null,
      },
    });
  } catch (error) {
    dependencies.emit({
      type: "workspace.setup.run.response",
      payload: {
        requestId: request.requestId,
        workspaceId: request.workspaceId,
        started: false,
        error: error instanceof Error ? error.message : "Failed to run workspace setup",
      },
    });
  }
}

export async function runWorktreeSetupInBackground(
  dependencies: CreateClisbotWorktreeInBackgroundDependencies,
  options: {
    requestCwd: string;
    repoRoot: string;
    workspaceId: string;
    worktree: WorktreeConfig;
    shouldBootstrap: boolean;
    slug: string;
    worktreePath: string;
    workspaceCwd?: string;
  },
  signal?: AbortSignal,
): Promise<void> {
  let worktree: WorktreeConfig = options.worktree;
  let setupResults: WorktreeSetupCommandResult[] = [];
  const progressAccumulator = createWorktreeSetupProgressAccumulator();
  const workspaceId = options.workspaceId;

  const emitSetupProgress = (status: "running" | "completed" | "failed", error: string | null) => {
    const snapshot: WorkspaceSetupSnapshot = {
      status,
      detail: buildWorktreeSetupDetail({
        worktree,
        results:
          status === "running"
            ? getWorktreeSetupProgressResults(progressAccumulator)
            : setupResults,
        outputAccumulatorsByIndex: progressAccumulator.outputAccumulatorsByIndex,
      }),
      error,
    };
    dependencies.cacheWorkspaceSetupSnapshot(workspaceId, snapshot);
    dependencies.emit({
      type: "workspace_setup_progress",
      payload: {
        workspaceId,
        ...snapshot,
      },
    });
  };

  try {
    try {
      emitSetupProgress("running", null);

      if (!options.shouldBootstrap) {
        emitSetupProgress("completed", null);
      } else {
        const workspaceCwd = options.workspaceCwd ?? worktree.worktreePath;
        const setupCommands = getWorktreeSetupCommands(workspaceCwd);
        const runtimeEnv = await resolveWorktreeRuntimeEnv({
          worktreePath: worktree.worktreePath,
          branchName: worktree.branchName,
          repoRootPath: options.repoRoot,
        });
        dependencies.terminalManager?.registerCwdEnv({
          cwd: workspaceCwd,
          env: runtimeEnv,
        });
        if (setupCommands.length === 0) {
          emitSetupProgress("completed", null);
        } else {
          setupResults = await runWorktreeSetupCommands({
            worktreePath: workspaceCwd,
            branchName: worktree.branchName,
            repoRootPath: options.repoRoot,
            runtimeEnv,
            signal,
            onEvent: (event) => {
              applyWorktreeSetupProgressEvent(progressAccumulator, event);
              emitSetupProgress("running", null);
            },
          });
          emitSetupProgress("completed", null);
        }
        await runWorktreeAutoTerminals({
          workspaceId,
          worktree,
          workspaceCwd,
          runtimeEnv,
          terminalManager: dependencies.terminalManager,
          logger: dependencies.sessionLogger,
        });
      }
    } catch (error) {
      if (error instanceof WorktreeSetupError) {
        setupResults = error.results;
      }
      const message = error instanceof Error ? error.message : String(error);
      emitSetupProgress("failed", message);

      dependencies.sessionLogger.error(
        {
          err: error,
          cwd: options.requestCwd,
          repoRoot: options.repoRoot,
          worktreeSlug: worktree.branchName,
          worktreePath: worktree.worktreePath,
        },
        "Background worktree setup failed",
      );
      return;
    }
  } finally {
    await dependencies.emitWorkspaceUpdateForWorkspaceId(options.workspaceId);
  }
}
