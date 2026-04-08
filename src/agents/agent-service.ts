import {
  type FollowUpMode,
} from "./follow-up-policy.ts";
import {
  type RunObserver,
  type RunUpdate,
} from "./run-observation.ts";
import { SessionStore } from "./session-store.ts";
import {
  AgentSessionState,
  type ActiveSessionRuntimeInfo,
} from "./session-state.ts";
import type { SessionRuntimeInfo } from "./session-runtime.ts";
import {
  getAgentEntry,
  type LoadedConfig,
  resolveSessionStorePath,
} from "../config/load-config.ts";
import {
  resolveAgentTarget,
  type AgentSessionTarget,
  type ResolvedAgentTarget,
} from "./resolved-target.ts";
export type { AgentSessionTarget } from "./resolved-target.ts";
import { TmuxClient } from "../runners/tmux/client.ts";
import { AgentJobQueue } from "./job-queue.ts";
import {
  RunnerSessionService,
  type ShellCommandResult,
} from "./runner-session.ts";
import {
  ActiveRunInProgressError,
  ActiveRunManager,
} from "./active-run-manager.ts";
export { ActiveRunInProgressError };

type StreamUpdate = RunUpdate;

type StreamCallbacks = {
  onUpdate: (update: StreamUpdate) => Promise<void> | void;
};

function escapeRegExp(raw: string) {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class AgentService {
  private tmuxClient: TmuxClient;
  private readonly queue = new AgentJobQueue();
  private readonly sessionState: AgentSessionState;
  private runnerSessions: RunnerSessionService;
  private activeRuns: ActiveRunManager;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly loadedConfig: LoadedConfig,
    deps: { tmux?: TmuxClient; sessionStore?: SessionStore } = {},
  ) {
    this.tmuxClient = deps.tmux ?? new TmuxClient(this.loadedConfig.raw.tmux.socketPath);
    const sessionStore = deps.sessionStore ?? new SessionStore(resolveSessionStorePath(this.loadedConfig));
    this.sessionState = new AgentSessionState(sessionStore);
    this.runnerSessions = new RunnerSessionService(
      this.loadedConfig,
      this.tmuxClient,
      this.sessionState,
      (target) => this.resolveTarget(target),
    );
    this.activeRuns = this.createActiveRunManager();
  }

  get tmux() {
    return this.tmuxClient;
  }

  set tmux(value: TmuxClient) {
    this.tmuxClient = value;
    this.runnerSessions = new RunnerSessionService(
      this.loadedConfig,
      this.tmuxClient,
      this.sessionState,
      (target) => this.resolveTarget(target),
    );
    this.activeRuns = this.createActiveRunManager();
  }

  private createActiveRunManager() {
    return new ActiveRunManager(
      this.tmuxClient,
      this.sessionState,
      this.runnerSessions,
      (target) => this.resolveTarget(target),
    );
  }

  async start() {
    await this.activeRuns.reconcileActiveRuns();
    const cleanup = this.loadedConfig.raw.control.sessionCleanup;
    if (!cleanup.enabled) {
      return;
    }

    await this.runnerSessions.runSessionCleanup();
    this.cleanupTimer = setInterval(() => {
      void this.runnerSessions.runSessionCleanup();
    }, cleanup.intervalMinutes * 60_000);
  }

  async stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  async cleanupStaleSessions() {
    await this.runnerSessions.runSessionCleanup();
  }

  private resolveTarget(target: AgentSessionTarget): ResolvedAgentTarget {
    return resolveAgentTarget(this.loadedConfig, target);
  }

  async captureTranscript(target: AgentSessionTarget) {
    return this.runnerSessions.captureTranscript(target);
  }

  async interruptSession(target: AgentSessionTarget) {
    return this.runnerSessions.interruptSession(target);
  }

  async getConversationFollowUpState(target: AgentSessionTarget) {
    return this.sessionState.getConversationFollowUpState(target);
  }

  async getSessionRuntime(target: AgentSessionTarget): Promise<SessionRuntimeInfo> {
    return this.sessionState.getSessionRuntime(target);
  }

  async listActiveSessionRuntimes(): Promise<ActiveSessionRuntimeInfo[]> {
    return this.sessionState.listActiveSessionRuntimes();
  }

  async setConversationFollowUpMode(target: AgentSessionTarget, mode: FollowUpMode) {
    return this.sessionState.setConversationFollowUpMode(this.resolveTarget(target), mode);
  }

  async resetConversationFollowUpMode(target: AgentSessionTarget) {
    return this.sessionState.resetConversationFollowUpMode(this.resolveTarget(target));
  }

  async reactivateConversationFollowUp(target: AgentSessionTarget) {
    return this.sessionState.reactivateConversationFollowUp(this.resolveTarget(target));
  }

  getResolvedAgentConfig(agentId: string) {
    return this.resolveTarget({
      agentId,
      sessionKey: this.loadedConfig.raw.session.mainKey,
    });
  }

  async recordConversationReply(target: AgentSessionTarget) {
    return this.sessionState.recordConversationReply(this.resolveTarget(target));
  }

  async runShellCommand(target: AgentSessionTarget, command: string): Promise<ShellCommandResult> {
    return this.queue.enqueue(`${target.sessionKey}:bash`, async () =>
      this.runnerSessions.runShellCommand(target, command),
    ).result;
  }

  getWorkspacePath(target: AgentSessionTarget) {
    return this.resolveTarget(target).workspacePath;
  }

  async observeRun(
    target: AgentSessionTarget,
    observer: Omit<RunObserver, "lastSentAt">,
  ) {
    return this.activeRuns.observeRun(target, observer);
  }

  async detachRunObserver(target: AgentSessionTarget, observerId: string) {
    return this.activeRuns.detachRunObserver(target, observerId);
  }

  enqueuePrompt(
    target: AgentSessionTarget,
    prompt: string,
    callbacks: StreamCallbacks & {
      observerId?: string;
    },
  ) {
    return this.queue.enqueue(target.sessionKey, async () =>
      this.activeRuns.executePrompt(target, prompt, {
        id: callbacks.observerId ?? `prompt:${target.sessionKey}`,
        mode: "live",
        onUpdate: callbacks.onUpdate,
      }),
    );
  }

  getMaxMessageChars(agentId: string) {
    const defaults = this.loadedConfig.raw.agents.defaults.stream;
    const override = getAgentEntry(this.loadedConfig, agentId)?.stream;
    return {
      ...defaults,
      ...(override ?? {}),
    }.maxMessageChars;
  }
}
