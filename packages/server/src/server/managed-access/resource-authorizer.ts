import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import type { AgentManager } from "../agent/agent-manager.js";
import { realpath } from "node:fs/promises";
import path from "node:path";
import type {
  AgentModelDefinition,
  AgentSessionConfig,
  ProviderSnapshotEntry,
} from "../agent/agent-sdk-types.js";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import type { TerminalManager } from "../../terminal/terminal-manager.js";
import type {
  PersistedProjectRecord,
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "../workspace-registry.js";
import { getPaseoWorktreesRoot, resolvePaseoWorktreesBaseRoot } from "../../utils/worktree.js";
import { isSameOrDescendantPath } from "../path-utils.js";
import type { SessionAuthorization } from "../authorization/index.js";
import {
  requiredPermissionForInbound,
  requiredPermissionForOutbound,
} from "../authorization/operation-permissions.js";
import type { ProjectPrivilege, ResolvedAgentConfigurationGrant } from "./types.js";

interface AgentStorageReader {
  get(agentId: string): Promise<StoredAgentRecord | null>;
  list(): Promise<StoredAgentRecord[]>;
  listByProviderSession(provider: string, providerHandleId: string): Promise<StoredAgentRecord[]>;
}

interface AgentConfigurationSafetyResolver {
  isUnattendedConfiguration(config: AgentSessionConfig): Promise<boolean>;
}

const TERMINAL_MESSAGES = new Set<SessionInboundMessage["type"]>([
  "list_terminals_request",
  "subscribe_terminals_request",
  "unsubscribe_terminals_request",
  "create_terminal_request",
  "subscribe_terminal_request",
  "unsubscribe_terminal_request",
  "terminal_input",
  "kill_terminal_request",
  "capture_terminal_request",
  "terminal.rename.request",
]);

const AGENT_INTERACTION_MESSAGES = new Set<SessionInboundMessage["type"]>([
  "send_agent_message_request",
  "cancel_agent_request",
  "refresh_agent_request",
  "delete_agent_request",
  "archive_agent_request",
  "update_agent_request",
  "clear_agent_attention",
  "agent.detach.request",
  "agent.rewind.request",
  "set_agent_mode_request",
  "set_agent_model_request",
  "set_agent_thinking_request",
  "set_agent_feature_request",
  "agent.config.apply.request",
  "set_voice_mode",
]);

const LIST_OUTBOUND_MESSAGES = new Set<SessionOutboundMessage["type"]>([
  "fetch_agents_response",
  "fetch_agent_history_response",
  "fetch_workspaces_response",
  "project.list.response",
  "terminals_changed",
  "list_terminals_response",
]);

const WORKSPACE_FILE_MESSAGES = new Set<SessionInboundMessage["type"]>([
  "file_explorer_request",
  "fs.file.subscribe.request",
  "fs.file.write.request",
  "fs.entry.create.request",
  "fs.entry.rename.request",
  "fs.entry.duplicate.request",
  "fs.entry.delete.request",
  "project_icon_request",
  "file_download_token_request",
]);

/**
 * Resolves daemon-native resources to the exact Project grants attached at
 * admission. It deliberately has no Hub role, Team, or organization concepts.
 */
export class ManagedResourceAuthorizer {
  private readonly projects = new Map<string, PersistedProjectRecord>();
  private readonly workspaces = new Map<string, PersistedWorkspaceRecord>();
  private readonly storedAgents = new Map<string, StoredAgentRecord>();
  private readonly visibleAgentIds = new Set<string>();
  private readonly visibleProjectIds = new Set<string>();
  private readonly visibleWorkspaceIds = new Set<string>();
  private readonly initialization: Promise<void>;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    private readonly authorization: SessionAuthorization,
    private readonly projectRegistry: ProjectRegistry,
    private readonly workspaceRegistry: WorkspaceRegistry,
    private readonly agentManager: AgentManager,
    private readonly agentStorage: AgentStorageReader,
    private readonly terminalManager: TerminalManager | null,
    private readonly agentConfigurationSafety: AgentConfigurationSafetyResolver,
  ) {
    // Mode off must retain the upstream path exactly: no registry reads,
    // subscriptions, managed state, or background rejection.
    this.initialization = this.isRestricted() ? this.load() : Promise.resolve();
    if (this.isRestricted()) this.subscribe();
  }

  async ready(): Promise<void> {
    await this.initialization;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.unsubscribe.length = 0;
  }

  isRestricted(): boolean {
    return this.authorization.isResourceRestricted();
  }

  allowsProject(projectId: string, privilege: ProjectPrivilege = "project.use"): boolean {
    if (!this.isRestricted()) return true;
    const project = this.projects.get(projectId);
    return (
      project !== undefined &&
      project.archivedAt === null &&
      this.authorization.allowsProject(projectId, privilege)
    );
  }

  async allowsWorkspace(
    workspaceId: string,
    privilege: ProjectPrivilege = "project.use",
  ): Promise<boolean> {
    if (!this.isRestricted()) return true;
    await this.ready();
    const workspace =
      this.workspaces.get(workspaceId) ?? (await this.workspaceRegistry.get(workspaceId));
    if (!workspace || workspace.archivedAt !== null) return false;
    this.workspaces.set(workspace.workspaceId, workspace);
    return this.allowsProject(workspace.projectId, privilege);
  }

  allowsWorkspaceSync(workspaceId: string, privilege: ProjectPrivilege = "project.use"): boolean {
    if (!this.isRestricted()) return true;
    const workspace = this.workspaces.get(workspaceId);
    return workspace?.archivedAt === null
      ? this.allowsProject(workspace.projectId, privilege)
      : false;
  }

  async allowsCwd(cwd: string, privilege: ProjectPrivilege = "project.use"): Promise<boolean> {
    if (!this.isRestricted()) return true;
    const projectId = await this.projectIdForCwd(cwd);
    return projectId !== null && this.allowsProject(projectId, privilege);
  }

  allowsCwdSync(cwd: string, privilege: ProjectPrivilege = "project.use"): boolean {
    if (!this.isRestricted()) return true;
    const projectId = this.projectIdForCwdSync(cwd);
    return projectId !== null && this.allowsProject(projectId, privilege);
  }

  async allowsWorkspaceRoot(
    cwd: string,
    privilege: ProjectPrivilege = "project.use",
  ): Promise<boolean> {
    if (!this.isRestricted()) return true;
    await this.ready();
    const canonicalCwd = await canonicalPathForAuthorization(cwd);
    if (canonicalCwd === null) return false;
    for (const workspace of this.workspaces.values()) {
      if (workspace.archivedAt !== null) continue;
      const canonicalRoot = await canonicalPathForAuthorization(workspace.cwd);
      if (
        canonicalRoot !== null &&
        canonicalRoot === canonicalCwd &&
        this.allowsProject(workspace.projectId, privilege)
      ) {
        return true;
      }
    }
    return false;
  }

  allowsWorkspaceRootSync(cwd: string, privilege: ProjectPrivilege = "project.use"): boolean {
    if (!this.isRestricted()) return true;
    const workspace = this.workspaceForExactCwd(cwd);
    return workspace !== null && this.allowsProject(workspace.projectId, privilege);
  }

  async projectIdForCwd(cwd: string): Promise<string | null> {
    await this.ready();
    return resolveProjectIdForAuthorizedCwd(cwd, this.workspaces.values(), this.projects.values());
  }

  private projectIdForCwdSync(cwd: string): string | null {
    return resolveProjectIdForCwd(cwd, this.workspaces.values(), this.projects.values());
  }

  async allowsAgent(
    agentId: string,
    privilege: ProjectPrivilege = "project.use",
  ): Promise<boolean> {
    if (!this.isRestricted()) return true;
    await this.ready();
    const live = this.agentManager.getAgent(agentId);
    const record = live ?? this.storedAgents.get(agentId) ?? (await this.agentStorage.get(agentId));
    if (!record?.workspaceId) return false;
    if (!("lifecycle" in record)) this.storedAgents.set(record.id, record);
    return this.allowsWorkspace(record.workspaceId, privilege);
  }

  allowsAgentSync(agentId: string, privilege: ProjectPrivilege = "project.use"): boolean {
    if (!this.isRestricted()) return true;
    const record = this.agentManager.getAgent(agentId) ?? this.storedAgents.get(agentId);
    return record?.workspaceId ? this.allowsWorkspaceSync(record.workspaceId, privilege) : false;
  }

  async allowsTerminal(terminalId: string): Promise<boolean> {
    if (!this.authorization.isLeaseActive()) return false;
    if (!this.isRestricted()) return true;
    const terminal = this.terminalManager?.getTerminal(terminalId);
    return terminal ? this.allowsWorkspace(terminal.workspaceId, "terminal.use") : false;
  }

  allowsTerminalSync(terminalId: string): boolean {
    if (!this.authorization.isLeaseActive()) return false;
    if (!this.isRestricted()) return true;
    const terminal = this.terminalManager?.getTerminal(terminalId);
    return terminal ? this.allowsWorkspaceSync(terminal.workspaceId, "terminal.use") : false;
  }

  allowsAnyProject(privilege: ProjectPrivilege = "project.use"): boolean {
    if (!this.isRestricted()) return true;
    for (const projectId of this.projects.keys()) {
      if (this.allowsProject(projectId, privilege)) return true;
    }
    return false;
  }

  allowsProjectRemoval(projectId: string): boolean {
    return !this.isRestricted() || this.visibleProjectIds.has(projectId);
  }

  allowsWorkspaceRemoval(workspaceId: string, projectId?: string): boolean {
    return (
      !this.isRestricted() ||
      this.visibleWorkspaceIds.has(workspaceId) ||
      (projectId !== undefined && this.visibleProjectIds.has(projectId))
    );
  }

  /**
   * Project sessions receive only the Provider choices that at least one of
   * their Agent-configuration grants can actually select. The unrestricted
   * path preserves the upstream objects and allocation behavior.
   */
  filterProviderCatalogEntries(
    entries: ProviderSnapshotEntry[],
    cwd: string | undefined,
  ): ProviderSnapshotEntry[] {
    if (!this.isRestricted()) return entries;
    const authorities = this.catalogAuthorities(cwd);
    return entries.flatMap((entry) => {
      const matching = authorities.filter(
        ({ configuration }) => configuration.providerId === entry.provider,
      );
      if (matching.length === 0) return [];
      const models = entry.models
        ? entry.models.flatMap((model) =>
            filterProviderModel(
              model,
              matching.map(({ configuration }) => configuration),
            ),
          )
        : undefined;
      const allowUnattended = matching.some(({ privileges }) =>
        hasEveryApprovalPrivilege(privileges),
      );
      return [
        {
          ...entry,
          ...(models === undefined ? {} : { models }),
          ...(entry.modes === undefined
            ? {}
            : {
                modes: entry.modes.filter((mode) => mode.isUnattended !== true || allowUnattended),
              }),
        },
      ];
    });
  }

  allowsOutbound(message: SessionOutboundMessage): boolean {
    if (!this.isRestricted()) return true;
    if (message.type.startsWith("workspace.label.")) {
      // Labels are one daemon-wide catalog today. Until the protocol carries a
      // Project owner, returning it would disclose names from other Projects.
      return false;
    }
    if (requiredPermissionForOutbound(message.type) === "daemon.read") {
      return this.allowsRestrictedDaemonReadOutbound(message);
    }
    const listProjection = this.allowsOutboundListProjection(message);
    if (listProjection !== undefined) return listProjection;
    const resourceUpdate = this.allowsOutboundResourceUpdate(message);
    if (resourceUpdate !== undefined) return resourceUpdate;
    if (LIST_OUTBOUND_MESSAGES.has(message.type)) return true;
    return this.allowsOutboundResourcePayload(message);
  }

  private allowsOutboundListProjection(message: SessionOutboundMessage): boolean | undefined {
    if (message.type === "project.list.response") {
      const allowed = message.payload.projects.every((project) =>
        this.allowsProject(project.projectId),
      );
      if (allowed) {
        for (const project of message.payload.projects) {
          this.visibleProjectIds.add(project.projectId);
        }
      }
      return allowed;
    }
    if (
      message.type === "fetch_agents_response" ||
      message.type === "fetch_agent_history_response"
    ) {
      const allowed = message.payload.entries.every((entry) =>
        this.allowsAgentSync(entry.agent.id),
      );
      if (allowed) {
        for (const entry of message.payload.entries) {
          this.visibleAgentIds.add(entry.agent.id);
        }
      }
      return allowed;
    }
    if (message.type === "fetch_workspaces_response") {
      const allowed =
        message.payload.entries.every((workspace) => this.allowsProject(workspace.projectId)) &&
        message.payload.emptyProjects.every((project) => this.allowsProject(project.projectId));
      if (allowed) {
        for (const workspace of message.payload.entries) {
          this.visibleWorkspaceIds.add(workspace.id);
          this.visibleProjectIds.add(workspace.projectId);
        }
        for (const project of message.payload.emptyProjects) {
          this.visibleProjectIds.add(project.projectId);
        }
      }
      return allowed;
    }
    return undefined;
  }

  private allowsOutboundResourceUpdate(message: SessionOutboundMessage): boolean | undefined {
    if (message.type === "project.update") {
      if (message.payload.kind === "upsert") {
        const allowed = this.allowsProject(message.payload.project.projectId);
        if (allowed) this.visibleProjectIds.add(message.payload.project.projectId);
        return allowed;
      }
      const visible = this.visibleProjectIds.delete(message.payload.projectId);
      return visible;
    }
    if (message.type === "workspace_update") {
      if (message.payload.kind === "upsert") {
        const allowed = this.allowsProject(message.payload.workspace.projectId);
        if (allowed) {
          this.visibleWorkspaceIds.add(message.payload.workspace.id);
          this.visibleProjectIds.add(message.payload.workspace.projectId);
        }
        return allowed;
      }
      const visible = this.visibleWorkspaceIds.delete(message.payload.id);
      if (message.payload.removedProjectId) {
        this.visibleProjectIds.delete(message.payload.removedProjectId);
      }
      return visible;
    }
    if (message.type === "agent_update") {
      if (message.payload.kind === "upsert") {
        const allowed = this.allowsAgentSync(message.payload.agent.id);
        if (allowed) this.visibleAgentIds.add(message.payload.agent.id);
        return allowed;
      }
      return this.visibleAgentIds.delete(message.payload.agentId);
    }
    if (message.type === "agent_deleted") {
      return this.visibleAgentIds.has(message.payload.agentId);
    }
    if (message.type === "terminal_stream_exit") {
      return this.allowsTerminalSync(message.payload.terminalId);
    }
    return undefined;
  }

  private allowsOutboundResourcePayload(message: SessionOutboundMessage): boolean {
    const payload = "payload" in message ? message.payload : null;
    if (!payload || typeof payload !== "object") return true;
    const agentDecision = this.allowsOutboundAgentPayload(payload);
    if (agentDecision !== undefined) return agentDecision;
    return this.allowsOutboundProjectPayload(message.type, payload);
  }

  private allowsOutboundAgentPayload(payload: object): boolean | undefined {
    const directAgentId =
      stringProperty(payload, "agentId") ?? stringProperty(payload, "parentAgentId");
    if (directAgentId) {
      const allowed = this.allowsAgentSync(directAgentId);
      if (allowed) this.visibleAgentIds.add(directAgentId);
      return allowed;
    }
    const agentIds = stringValuesProperty(payload, "agentIds");
    if (agentIds.length > 0) {
      return agentIds.every((agentId) => this.allowsAgentSync(agentId));
    }
    const agent = objectProperty(payload, "agent");
    const agentId = stringProperty(agent, "id");
    if (agentId) {
      const allowed = this.allowsAgentSync(agentId);
      if (allowed) this.visibleAgentIds.add(agentId);
      return allowed;
    }
    const subagent = objectProperty(payload, "subagent");
    const subagentParentId = stringProperty(subagent, "parentAgentId");
    if (subagentParentId) return this.allowsAgentSync(subagentParentId);
    return undefined;
  }

  private allowsOutboundProjectPayload(
    messageType: SessionOutboundMessage["type"],
    payload: object,
  ): boolean {
    const terminalId = stringProperty(payload, "terminalId");
    if (terminalId) return this.allowsTerminalSync(terminalId);
    const terminal = objectProperty(payload, "terminal");
    const terminalWorkspaceId = stringProperty(terminal, "workspaceId");
    if (terminalWorkspaceId) return this.allowsWorkspaceSync(terminalWorkspaceId, "terminal.use");

    const workspaceId = stringProperty(payload, "workspaceId");
    if (workspaceId) return this.allowsWorkspaceSync(workspaceId);
    const workspace = objectProperty(payload, "workspace");
    const workspaceProjectId = stringProperty(workspace, "projectId");
    if (workspaceProjectId) return this.allowsProject(workspaceProjectId);

    const projectId = stringProperty(payload, "projectId") ?? stringProperty(payload, "projectKey");
    if (projectId) return this.allowsProject(projectId);

    const project = objectProperty(payload, "project");
    const nestedProjectId = stringProperty(project, "projectId");
    if (nestedProjectId) return this.allowsProject(nestedProjectId);

    const cwd = stringProperty(payload, "cwd");
    if (cwd) {
      return isWorkspaceFileOutbound(messageType)
        ? this.allowsWorkspaceRootSync(cwd)
        : this.allowsCwdSync(cwd);
    }
    const fileVersion = objectProperty(payload, "version") ?? objectProperty(payload, "initial");
    const fileCwd = stringProperty(fileVersion, "cwd");
    if (fileCwd) return this.allowsWorkspaceRootSync(fileCwd);
    const checkout = objectProperty(payload, "checkout");
    const checkoutCwd = stringProperty(checkout, "cwd");
    return checkoutCwd ? this.allowsCwdSync(checkoutCwd) : true;
  }

  async allowsAgentConfiguration(
    workspaceId: string,
    config: AgentSessionConfig,
  ): Promise<boolean> {
    if (!this.isRestricted()) return true;
    await this.ready();
    const workspace =
      this.workspaces.get(workspaceId) ?? (await this.workspaceRegistry.get(workspaceId));
    if (!workspace || !(await isSameOrDescendantExistingPath(workspace.cwd, config.cwd)))
      return false;
    return await this.configurationMatchesProject(workspace.projectId, config, "agent.create");
  }

  private async allowsAgentConfigurationForProject(
    projectId: string,
    workspaceId: string | undefined,
    config: AgentSessionConfig,
  ): Promise<boolean> {
    const workspace =
      workspaceId === undefined
        ? undefined
        : (this.workspaces.get(workspaceId) ??
          (await this.workspaceRegistry.get(workspaceId)) ??
          undefined);
    if (workspace !== undefined && workspace !== null) {
      if (
        workspace.projectId !== projectId ||
        !(await isSameOrDescendantExistingPath(workspace.cwd, config.cwd))
      ) {
        return false;
      }
    } else {
      if ((await this.projectIdForCwd(config.cwd)) !== projectId) return false;
    }
    return this.configurationMatchesProject(projectId, config, "agent.create");
  }

  private async configurationMatchesProject(
    projectId: string,
    config: AgentSessionConfig,
    requiredPrivilege: "agent.create" | "agent.interact",
  ): Promise<boolean> {
    if (!this.authorization.allowsProject(projectId, requiredPrivilege)) return false;
    const grant = this.authorization.project(projectId);
    if (!grant) return false;
    if (config.featureValues?.fast_mode === true && !grant.privileges.has("agent.fast.use")) {
      return false;
    }
    if (config.toolPolicy?.preapproved.length && !hasEveryApprovalPrivilege(grant.privileges)) {
      return false;
    }
    let unattended: boolean;
    try {
      unattended = await this.agentConfigurationSafety.isUnattendedConfiguration(config);
    } catch {
      // A restricted session must not gain a no-prompt execution path merely
      // because provider metadata is unavailable or malformed.
      return false;
    }
    if (unattended && !hasEveryApprovalPrivilege(grant.privileges)) {
      return false;
    }
    return grant.agentConfigurations.some((candidate) => {
      if (candidate.providerId !== config.provider) return false;
      if (!matchesExplicitSelection(config.model, candidate.modelIds)) return false;
      return matchesExplicitSelection(config.thinkingOptionId, candidate.thinkingOptionIds);
    });
  }

  private async allowsExistingAgentConfiguration(
    agentId: string,
    update: {
      model?: string | null;
      modeId?: string;
      thinkingOptionId?: string | null;
      featureValues?: Record<string, unknown>;
    },
  ): Promise<boolean> {
    const live = this.agentManager.getAgent(agentId);
    const stored = live
      ? null
      : (this.storedAgents.get(agentId) ?? (await this.agentStorage.get(agentId)));
    const record = live ?? stored;
    if (!record?.workspaceId) return false;
    const workspace =
      this.workspaces.get(record.workspaceId) ??
      (await this.workspaceRegistry.get(record.workspaceId));
    if (!workspace) return false;
    const current = record.config;
    if (!current) return false;
    const base: AgentSessionConfig = live
      ? live.config
      : storedAgentConfig(stored as StoredAgentRecord);
    const next: AgentSessionConfig = {
      ...base,
      ...(update.model !== undefined ? { model: update.model ?? undefined } : {}),
      ...(update.modeId !== undefined ? { modeId: update.modeId } : {}),
      ...(update.thinkingOptionId !== undefined
        ? { thinkingOptionId: update.thinkingOptionId ?? undefined }
        : {}),
      ...(update.featureValues
        ? { featureValues: { ...base.featureValues, ...update.featureValues } }
        : {}),
    };
    return await this.configurationMatchesProject(workspace.projectId, next, "agent.interact");
  }

  /** Explain forbidden actions only after every supplied target is visible to this session. */
  async denialCode(
    message: SessionInboundMessage,
  ): Promise<"access_denied" | "resource_not_found"> {
    await this.ready();
    const checks: Array<Promise<boolean> | boolean> = [];
    for (const agentId of agentIdsOf(message)) checks.push(this.allowsAgent(agentId));
    for (const workspaceId of stringValuesProperty(message, "workspaceId")) {
      checks.push(this.allowsWorkspace(workspaceId));
    }
    for (const projectId of stringValuesProperty(message, "projectId")) {
      checks.push(this.allowsProject(projectId));
    }
    for (const cwd of stringValuesProperty(message, "cwd")) checks.push(this.allowsCwd(cwd));
    for (const terminalId of stringValuesProperty(message, "terminalId")) {
      const terminal = this.terminalManager?.getTerminal(terminalId);
      checks.push(terminal ? this.allowsWorkspace(terminal.workspaceId) : false);
    }
    if (message.type === "workspace.create.request") {
      const source = message.source;
      if (source.projectId !== undefined) checks.push(this.allowsProject(source.projectId));
      const cwd = source.kind === "directory" ? source.path : source.cwd;
      if (cwd !== undefined) checks.push(this.allowsCwd(cwd));
    }
    return checks.length > 0 && (await Promise.all(checks)).every(Boolean)
      ? "access_denied"
      : "resource_not_found";
  }

  async allowsInbound(message: SessionInboundMessage): Promise<boolean> {
    if (!this.isRestricted()) return true;
    await this.ready();

    if (message.type.startsWith("workspace.label.")) return false;

    if (requiredPermissionForInbound(message.type) === "daemon.read") {
      return this.allowsRestrictedDaemonReadInbound(message);
    }

    if (message.type === "browser.automation.execute.response") {
      // Browser-host execution is daemon-global today. Until broker requests
      // carry a Project owner, a Project-scoped client must neither receive nor
      // complete another session's pending browser operation.
      return false;
    }

    if (WORKSPACE_FILE_MESSAGES.has(message.type)) {
      return "cwd" in message && typeof message.cwd === "string"
        ? this.allowsWorkspaceRoot(message.cwd)
        : false;
    }

    const agentLifecycle = await this.allowsAgentLifecycleInbound(message);
    if (agentLifecycle !== undefined) return agentLifecycle;

    if (message.type === "file.upload.request") return this.allowsAnyProject();

    const agentConfiguration = await this.allowsAgentConfigurationInbound(message);
    if (agentConfiguration !== undefined) return agentConfiguration;

    const operation = await this.allowsOperationalInbound(message);
    if (operation !== undefined) return operation;

    const workspace = await this.allowsWorkspaceInbound(message);
    if (workspace !== undefined) return workspace;

    const privilege: ProjectPrivilege = AGENT_INTERACTION_MESSAGES.has(message.type)
      ? "agent.interact"
      : "project.use";
    const checks: Array<Promise<boolean> | boolean> = [];
    for (const agentId of agentIdsOf(message)) {
      checks.push(this.allowsAgent(agentId, privilege));
    }
    for (const workspaceId of stringValuesProperty(message, "workspaceId")) {
      checks.push(this.allowsWorkspace(workspaceId, "project.use"));
    }
    for (const projectId of stringValuesProperty(message, "projectId")) {
      checks.push(this.allowsProject(projectId, "project.use"));
    }
    for (const cwd of stringValuesProperty(message, "cwd")) {
      checks.push(this.allowsCwd(cwd, "project.use"));
    }
    if (checks.length === 0) return true;
    return (await Promise.all(checks)).every(Boolean);
  }

  private async allowsAgentLifecycleInbound(
    message: SessionInboundMessage,
  ): Promise<boolean | undefined> {
    if (message.type === "agent_permission_response") {
      if (!(await this.allowsAgent(message.agentId, "project.use"))) return false;
      if (message.response.behavior === "deny") return true;
      const request = this.agentManager
        .getPendingPermissions(message.agentId)
        .find((candidate) => candidate.id === message.requestId);
      if (!request) return false;
      const privilege = approvalPrivilegeFor(request);
      return privilege !== null && this.allowsAgent(message.agentId, privilege);
    }
    if (message.type === "create_agent_request") {
      if (message.projectId !== undefined) {
        return this.allowsAgentConfigurationForProject(
          message.projectId,
          message.workspaceId,
          message.config,
        );
      }
      const workspaceId =
        message.workspaceId ?? this.longestWorkspaceRoot(message.config.cwd)?.workspaceId;
      return workspaceId ? this.allowsAgentConfiguration(workspaceId, message.config) : false;
    }
    if (message.type === "import_agent_request") {
      // Import carries no effective Model, Mode, Thinking, or tool policy, so
      // a Project-scoped session cannot prove it matches its grant.
      return false;
    }
    if (message.type === "resume_agent_request") return this.allowsResumeAgent(message);
    return undefined;
  }

  private async allowsResumeAgent(
    message: Extract<SessionInboundMessage, { type: "resume_agent_request" }>,
  ): Promise<boolean> {
    if (!message.handle) return false;
    const records = await this.agentStorage.listByProviderSession(
      message.handle.provider,
      message.handle.sessionId,
    );
    if (records.length === 0) return false;
    const decisions = await Promise.all(
      records.map(async (record) => {
        if (!record.workspaceId) return false;
        const config: AgentSessionConfig = {
          ...storedAgentConfig(record),
          ...message.overrides,
        };
        const workspace =
          this.workspaces.get(record.workspaceId) ??
          (await this.workspaceRegistry.get(record.workspaceId));
        if (
          !workspace ||
          workspace.archivedAt !== null ||
          !(await isSameOrDescendantExistingPath(workspace.cwd, config.cwd))
        ) {
          return false;
        }
        return this.configurationMatchesProject(workspace.projectId, config, "agent.interact");
      }),
    );
    return decisions.every(Boolean);
  }

  private async allowsAgentConfigurationInbound(
    message: SessionInboundMessage,
  ): Promise<boolean | undefined> {
    if (
      message.type === "set_agent_feature_request" &&
      message.featureId === "fast_mode" &&
      message.value === true &&
      !(await this.allowsAgent(message.agentId, "agent.fast.use"))
    ) {
      return false;
    }
    if (message.type === "set_agent_model_request") {
      return this.allowsExistingAgentConfiguration(message.agentId, { model: message.modelId });
    }
    if (message.type === "set_agent_mode_request") {
      return this.allowsExistingAgentConfiguration(message.agentId, { modeId: message.modeId });
    }
    if (message.type === "set_agent_thinking_request") {
      return this.allowsExistingAgentConfiguration(message.agentId, {
        thinkingOptionId: message.thinkingOptionId,
      });
    }
    if (message.type === "set_agent_feature_request") {
      return this.allowsExistingAgentConfiguration(message.agentId, {
        featureValues: { [message.featureId]: message.value },
      });
    }
    if (message.type === "agent.config.apply.request") {
      return this.allowsExistingAgentConfiguration(message.agentId, {
        ...(message.config.modelId !== undefined ? { model: message.config.modelId } : {}),
        ...(message.config.thinkingOptionId !== undefined
          ? { thinkingOptionId: message.config.thinkingOptionId }
          : {}),
        ...(message.config.modeId !== undefined ? { modeId: message.config.modeId } : {}),
        ...(message.config.featureValues ? { featureValues: message.config.featureValues } : {}),
      });
    }
    return undefined;
  }

  private async allowsOperationalInbound(
    message: SessionInboundMessage,
  ): Promise<boolean | undefined> {
    if (message.type === "close_items_request") {
      const agentsAllowed = await Promise.all(
        message.agentIds.map((agentId) => this.allowsAgent(agentId, "agent.interact")),
      );
      const terminalsAllowed = await Promise.all(
        message.terminalIds.map((terminalId) => this.allowsTerminal(terminalId)),
      );
      return agentsAllowed.every(Boolean) && terminalsAllowed.every(Boolean);
    }
    if (TERMINAL_MESSAGES.has(message.type)) return this.allowsTerminalInbound(message);
    if (message.type === "client_heartbeat") {
      if (
        message.focusedAgentId !== null &&
        !(await this.allowsAgent(message.focusedAgentId, "project.use"))
      ) {
        return false;
      }
      return (
        message.focusedTerminalId == null || (await this.allowsTerminal(message.focusedTerminalId))
      );
    }
    return undefined;
  }

  private async allowsTerminalInbound(message: SessionInboundMessage): Promise<boolean> {
    if (
      "terminalId" in message &&
      typeof message.terminalId === "string" &&
      !(await this.allowsTerminal(message.terminalId))
    ) {
      return false;
    }
    if (
      "workspaceId" in message &&
      typeof message.workspaceId === "string" &&
      !(await this.allowsWorkspace(message.workspaceId, "terminal.use"))
    ) {
      return false;
    }
    if (
      "cwd" in message &&
      typeof message.cwd === "string" &&
      !(await this.allowsCwd(message.cwd, "terminal.use"))
    ) {
      return false;
    }
    if (
      "agentId" in message &&
      typeof message.agentId === "string" &&
      !(await this.allowsAgent(message.agentId, "terminal.use"))
    ) {
      return false;
    }
    return (
      message.type === "list_terminals_request" ||
      "terminalId" in message ||
      "workspaceId" in message ||
      "cwd" in message
    );
  }

  private async allowsWorkspaceInbound(
    message: SessionInboundMessage,
  ): Promise<boolean | undefined> {
    if (message.type === "directory_suggestions_request") {
      return message.cwd === undefined ? false : this.allowsCwd(message.cwd);
    }
    if (message.type === "fetch_recent_provider_sessions_request") {
      return message.cwd === undefined ? false : this.allowsCwd(message.cwd);
    }
    if (
      message.type === "read_project_config_request" ||
      message.type === "write_project_config_request"
    ) {
      return this.allowsCwd(message.repoRoot);
    }
    if (message.type === "paseo_worktree_list_request") {
      const cwd = message.repoRoot ?? message.cwd;
      return cwd === undefined ? false : this.allowsCwd(cwd);
    }
    if (message.type === "paseo_worktree_archive_request") {
      if (message.workspaceId !== undefined) {
        return this.allowsWorkspace(message.workspaceId, "project.use");
      }
      const cwd = message.worktreePath ?? message.repoRoot;
      return cwd === undefined ? false : this.allowsCwd(cwd);
    }
    if (message.type === "open_in_editor_request")
      return this.allowsCwd(message.cwd ?? message.path);
    if (message.type === "project.create_directory.request") {
      return this.allowsCwd(message.parentPath);
    }
    if (message.type === "project.github.clone.request") {
      return this.allowsCwd(message.targetDirectory);
    }
    if (message.type === "workspace.github.search_repositories.request") return false;
    if (message.type === "workspace.create.request") return this.allowsWorkspaceCreate(message);
    return undefined;
  }

  private async allowsWorkspaceCreate(
    message: Extract<SessionInboundMessage, { type: "workspace.create.request" }>,
  ): Promise<boolean> {
    const source = message.source;
    // Missing projectId takes an upstream compatibility path that can add a Project.
    // Managed creation must always attach to an existing, explicitly granted Project.
    const projectId = source.projectId;
    if (projectId === undefined || !this.allowsProject(projectId, "workspace.create")) return false;
    const project = this.projects.get(projectId);
    if (!project) return false;
    const cwd = source.kind === "directory" ? source.path : (source.cwd ?? project.rootPath);
    const canonicalCwd = await canonicalPathForAuthorization(cwd);
    if (canonicalCwd === null || (await this.projectIdForCwd(cwd)) !== projectId) return false;
    const roots = [
      project.rootPath,
      ...[...this.workspaces.values()]
        .filter((workspace) => workspace.projectId === projectId && workspace.archivedAt === null)
        .map((workspace) => workspace.cwd),
    ];
    for (const root of roots) {
      if ((await canonicalPathForAuthorization(root)) === canonicalCwd) return true;
    }
    return false;
  }

  async allowsWorktreeDestination(
    sourceCwd: string,
    paseoHome: string,
    worktreesRoot?: string,
  ): Promise<boolean> {
    if (!this.isRestricted()) return true;
    const baseRoot = resolvePaseoWorktreesBaseRoot({ paseoHome, worktreesRoot });
    const projectRoot = await getPaseoWorktreesRoot(sourceCwd, paseoHome, worktreesRoot);
    // The daemon generates a validated single-segment slug below this root.
    // Reject a project-hash directory symlink that would redirect creation elsewhere.
    return isSameOrDescendantExistingPath(baseRoot, projectRoot);
  }

  private async load(): Promise<void> {
    const [projects, workspaces, agents] = await Promise.all([
      this.projectRegistry.list(),
      this.workspaceRegistry.list(),
      this.agentStorage.list(),
    ]);
    for (const project of projects) this.projects.set(project.projectId, project);
    for (const workspace of workspaces) this.workspaces.set(workspace.workspaceId, workspace);
    for (const agent of agents) this.storedAgents.set(agent.id, agent);
  }

  private catalogAuthorities(cwd: string | undefined): Array<{
    configuration: ResolvedAgentConfigurationGrant;
    privileges: ReadonlySet<ProjectPrivilege>;
  }> {
    const projectIds =
      cwd === undefined
        ? [...this.projects.keys()]
        : [this.projectIdForCwdSync(cwd)].filter(
            (projectId): projectId is string => projectId !== null,
          );
    return projectIds.flatMap((projectId) => {
      const project = this.authorization.project(projectId);
      if (project === undefined || !this.authorization.allowsProject(projectId, "project.use")) {
        return [];
      }
      return project.agentConfigurations.map((configuration) => ({
        configuration,
        privileges: project.privileges,
      }));
    });
  }

  private canReadProviderCatalog(provider: string, cwd: string | undefined): boolean {
    return this.catalogAuthorities(cwd).some(
      ({ configuration }) => configuration.providerId === provider,
    );
  }

  private async allowsRestrictedDaemonReadInbound(
    message: SessionInboundMessage,
  ): Promise<boolean> {
    switch (message.type) {
      case "ping":
        return true;
      case "list_commands_request":
        return this.allowsAgent(message.agentId, "project.use");
      case "list_available_providers_request":
        return this.catalogAuthorities(undefined).length > 0;
      case "list_provider_models_request":
      case "list_provider_modes_request":
        return this.canReadProviderCatalog(message.provider, message.cwd);
      case "list_provider_features_request": {
        const config = message.draftConfig;
        const projectId = this.projectIdForCwdSync(config.cwd);
        if (projectId === null) return false;
        const project = this.authorization.project(projectId);
        if (!project || !this.authorization.allowsProject(projectId, "project.use")) return false;
        return project.agentConfigurations.some((candidate) => {
          if (candidate.providerId !== config.provider) return false;
          if (
            config.model !== undefined &&
            !matchesExplicitSelection(config.model, candidate.modelIds)
          ) {
            return false;
          }
          return (
            config.thinkingOptionId === undefined ||
            matchesExplicitSelection(config.thinkingOptionId, candidate.thinkingOptionIds)
          );
        });
      }
      case "get_providers_snapshot_request":
        return message.cwd === undefined
          ? this.catalogAuthorities(undefined).length > 0
          : this.allowsCwdSync(message.cwd);
      case "refresh_providers_snapshot_request": {
        if (message.cwd !== undefined && !this.allowsCwdSync(message.cwd)) return false;
        const requested = message.providers ?? [];
        return requested.length === 0
          ? this.catalogAuthorities(message.cwd).length > 0
          : requested.every((provider) => this.canReadProviderCatalog(provider, message.cwd));
      }
      default:
        // `daemon.read` also protects config, status, diagnostics, usage, and
        // skills. Project authority never opens those daemon-global surfaces.
        return false;
    }
  }

  private allowsRestrictedDaemonReadOutbound(message: SessionOutboundMessage): boolean {
    switch (message.type) {
      case "pong":
      case "get_providers_snapshot_response":
      case "providers_snapshot_update":
      case "refresh_providers_snapshot_response":
      case "list_available_providers_response":
        return true;
      case "list_provider_models_response":
      case "list_provider_modes_response":
      case "list_provider_features_response":
        return this.canReadProviderCatalog(message.payload.provider, undefined);
      case "list_commands_response":
        return this.allowsAgentSync(message.payload.agentId);
      case "status": {
        const status = stringProperty(message.payload, "status");
        if (status === "server_info" || status === "agent_create_failed") return true;
        if (
          status === "agent_created" ||
          status === "agent_resumed" ||
          status === "agent_refreshed"
        ) {
          const agentId = stringProperty(message.payload, "agentId");
          return agentId !== null && this.allowsAgentSync(agentId);
        }
        return false;
      }
      default:
        return false;
    }
  }

  private subscribe(): void {
    const unsubscribeProjects = this.projectRegistry.subscribeToMutations?.((mutation) => {
      if (mutation.project) this.projects.set(mutation.projectId, mutation.project);
      else this.projects.delete(mutation.projectId);
    });
    if (unsubscribeProjects) this.unsubscribe.push(unsubscribeProjects);

    const unsubscribeWorkspaces = this.workspaceRegistry.subscribeToMutations?.((mutation) => {
      if (mutation.workspace) this.workspaces.set(mutation.workspaceId, mutation.workspace);
      else this.workspaces.delete(mutation.workspaceId);
    });
    if (unsubscribeWorkspaces) this.unsubscribe.push(unsubscribeWorkspaces);
  }

  private longestWorkspaceRoot(cwd: string): PersistedWorkspaceRecord | null {
    let result: PersistedWorkspaceRecord | null = null;
    for (const workspace of this.workspaces.values()) {
      if (workspace.archivedAt !== null) continue;
      if (!isSameOrDescendantPath(workspace.cwd, cwd)) continue;
      if (!result || workspace.cwd.length > result.cwd.length) result = workspace;
    }
    return result;
  }

  private workspaceForExactCwd(cwd: string): PersistedWorkspaceRecord | null {
    for (const workspace of this.workspaces.values()) {
      if (workspace.archivedAt !== null) continue;
      if (
        isSameOrDescendantPath(workspace.cwd, cwd) &&
        isSameOrDescendantPath(cwd, workspace.cwd)
      ) {
        return workspace;
      }
    }
    return null;
  }
}

/** Resolves daemon-owned Project placement, preferring the most specific active Workspace. */
export function resolveProjectIdForCwd(
  cwd: string,
  workspaces: Iterable<PersistedWorkspaceRecord>,
  projects: Iterable<PersistedProjectRecord>,
): string | null {
  let workspace: PersistedWorkspaceRecord | null = null;
  for (const candidate of workspaces) {
    if (candidate.archivedAt !== null) continue;
    if (!isSameOrDescendantPath(candidate.cwd, cwd)) continue;
    if (!workspace || candidate.cwd.length > workspace.cwd.length) workspace = candidate;
  }
  if (workspace) return workspace.projectId;

  let project: PersistedProjectRecord | null = null;
  for (const candidate of projects) {
    if (candidate.archivedAt !== null) continue;
    if (!isSameOrDescendantPath(candidate.rootPath, cwd)) continue;
    if (!project || candidate.rootPath.length > project.rootPath.length) project = candidate;
  }
  return project?.projectId ?? null;
}

/** Resolves an existing cwd after following symlinks; unavailable paths fail closed. */
export async function resolveProjectIdForExistingCwd(
  cwd: string,
  workspaces: Iterable<PersistedWorkspaceRecord>,
  projects: Iterable<PersistedProjectRecord>,
): Promise<string | null> {
  const canonicalCwd = await canonicalExistingPath(cwd);
  if (canonicalCwd === null) return null;
  const [canonicalWorkspaces, canonicalProjects] = await Promise.all([
    Promise.all(
      Array.from(workspaces, async (workspace) => {
        const canonicalRoot = await canonicalExistingPath(workspace.cwd);
        return canonicalRoot === null ? null : { ...workspace, cwd: canonicalRoot };
      }),
    ),
    Promise.all(
      Array.from(projects, async (project) => {
        const canonicalRoot = await canonicalExistingPath(project.rootPath);
        return canonicalRoot === null ? null : { ...project, rootPath: canonicalRoot };
      }),
    ),
  ]);
  return resolveProjectIdForCwd(
    canonicalCwd,
    canonicalWorkspaces.filter((workspace) => workspace !== null),
    canonicalProjects.filter((project) => project !== null),
  );
}

export async function assertProjectCwdPlacement(
  cwd: string,
  projectId: string,
  projectRegistry: Pick<ProjectRegistry, "get" | "list">,
  workspaceRegistry: Pick<WorkspaceRegistry, "list">,
): Promise<void> {
  const project = await projectRegistry.get(projectId);
  if (!project || project.archivedAt !== null) {
    throw new Error(`Unknown project: ${projectId}`);
  }
  const [workspaces, projects] = await Promise.all([
    workspaceRegistry.list(),
    projectRegistry.list(),
  ]);
  if ((await resolveProjectIdForExistingCwd(cwd, workspaces, projects)) !== projectId) {
    throw new Error(`cwd does not belong to Project ${projectId}`);
  }
}

async function resolveProjectIdForAuthorizedCwd(
  cwd: string,
  workspaces: Iterable<PersistedWorkspaceRecord>,
  projects: Iterable<PersistedProjectRecord>,
): Promise<string | null> {
  const canonicalCwd = await canonicalPathForAuthorization(cwd);
  if (canonicalCwd === null) return null;
  const [canonicalWorkspaces, canonicalProjects] = await Promise.all([
    Promise.all(
      Array.from(workspaces, async (workspace) => {
        const canonicalRoot = await canonicalPathForAuthorization(workspace.cwd);
        return canonicalRoot === null ? null : { ...workspace, cwd: canonicalRoot };
      }),
    ),
    Promise.all(
      Array.from(projects, async (project) => {
        const canonicalRoot = await canonicalPathForAuthorization(project.rootPath);
        return canonicalRoot === null ? null : { ...project, rootPath: canonicalRoot };
      }),
    ),
  ]);
  return resolveProjectIdForCwd(
    canonicalCwd,
    canonicalWorkspaces.filter((workspace) => workspace !== null),
    canonicalProjects.filter((project) => project !== null),
  );
}

async function canonicalExistingPath(value: string): Promise<string | null> {
  try {
    return await realpath(value);
  } catch {
    return null;
  }
}

async function canonicalPathForAuthorization(value: string): Promise<string | null> {
  if (!path.isAbsolute(value)) return null;
  let cursor = value;
  const suffix: string[] = [];
  while (true) {
    const canonical = await canonicalExistingPath(cursor);
    if (canonical !== null) {
      const result = path.resolve(canonical, ...suffix);
      return isSameOrDescendantPath(canonical, result) ? result : null;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    const segment = path.basename(cursor);
    if (segment.length === 0 || segment === "." || segment === "..") return null;
    suffix.unshift(segment);
    cursor = parent;
  }
}

async function isSameOrDescendantExistingPath(
  basePath: string,
  candidatePath: string,
): Promise<boolean> {
  const [canonicalBase, canonicalCandidate] = await Promise.all([
    canonicalPathForAuthorization(basePath),
    canonicalPathForAuthorization(candidatePath),
  ]);
  return (
    canonicalBase !== null &&
    canonicalCandidate !== null &&
    isSameOrDescendantPath(canonicalBase, canonicalCandidate)
  );
}

function isWorkspaceFileOutbound(type: SessionOutboundMessage["type"]): boolean {
  return (
    type === "file_explorer_response" ||
    type === "fs.file.write.response" ||
    type === "fs.entry.create.response" ||
    type === "fs.entry.rename.response" ||
    type === "fs.entry.duplicate.response" ||
    type === "fs.entry.delete.response" ||
    type === "project_icon_response" ||
    type === "file_download_token_response"
  );
}

function storedAgentConfig(record: StoredAgentRecord): AgentSessionConfig {
  const config = record.config;
  return {
    provider: record.provider,
    cwd: record.cwd,
    ...(config?.modeId ? { modeId: config.modeId } : {}),
    ...(config?.model ? { model: config.model } : {}),
    ...(config?.thinkingOptionId ? { thinkingOptionId: config.thinkingOptionId } : {}),
    ...(config?.featureValues ? { featureValues: config.featureValues } : {}),
    ...(config?.providerOptions ? { providerOptions: config.providerOptions } : {}),
    ...(config?.toolPolicy ? { toolPolicy: config.toolPolicy } : {}),
    ...(config?.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
    ...(config?.mcpServers ? { mcpServers: config.mcpServers } : {}),
  };
}

function agentIdsOf(message: SessionInboundMessage): string[] {
  const result = [
    ...stringValuesProperty(message, "agentId"),
    ...stringValuesProperty(message, "agentIds"),
  ];
  if ("parentAgentId" in message && typeof message.parentAgentId === "string") {
    result.push(message.parentAgentId);
  }
  if ("callerAgentId" in message && typeof message.callerAgentId === "string") {
    result.push(message.callerAgentId);
  }
  return result;
}

function objectProperty(value: object, key: string): Record<string, unknown> | null {
  const property = key in value ? (value as Record<string, unknown>)[key] : null;
  return property !== null && typeof property === "object"
    ? (property as Record<string, unknown>)
    : null;
}

function stringProperty(value: object | null, key: string): string | null {
  if (!value || !(key in value)) return null;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : null;
}

function stringValuesProperty(value: object, key: string): string[] {
  if (!(key in value)) return [];
  const property = (value as Record<string, unknown>)[key];
  if (typeof property === "string") return [property];
  return Array.isArray(property)
    ? property.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function matchesExplicitSelection(
  selected: string | undefined,
  allowed: "*" | readonly string[],
): boolean {
  if (allowed === "*") return true;
  return selected !== undefined && allowed.includes(selected);
}

function filterProviderModel(
  model: AgentModelDefinition,
  configurations: readonly ResolvedAgentConfigurationGrant[],
): AgentModelDefinition[] {
  const matching = configurations.filter(
    ({ modelIds }) => modelIds === "*" || modelIds.includes(model.id),
  );
  if (matching.length === 0) return [];
  if (
    model.thinkingOptions === undefined ||
    matching.some(({ thinkingOptionIds }) => thinkingOptionIds === "*")
  ) {
    return [model];
  }
  const allowed = new Set(
    matching.flatMap(({ thinkingOptionIds }) =>
      thinkingOptionIds === "*" ? [] : thinkingOptionIds,
    ),
  );
  const thinkingOptions = model.thinkingOptions.filter(({ id }) => allowed.has(id));
  if (thinkingOptions.length === 0) return [];
  const projected: AgentModelDefinition = { ...model, thinkingOptions };
  if (
    projected.defaultThinkingOptionId !== undefined &&
    !allowed.has(projected.defaultThinkingOptionId)
  ) {
    projected.defaultThinkingOptionId =
      thinkingOptions.find(({ isDefault }) => isDefault)?.id ?? thinkingOptions[0]?.id;
  }
  return [projected];
}

function hasEveryApprovalPrivilege(privileges: ReadonlySet<ProjectPrivilege>): boolean {
  return [
    "approval.file",
    "approval.config",
    "approval.command",
    "approval.command.destructive",
    "approval.channel",
  ].every((privilege) => privileges.has(privilege as ProjectPrivilege));
}

function approvalPrivilegeFor(request: {
  name: string;
  input?: Record<string, unknown>;
  detail?: { type: string; command?: string };
}): ProjectPrivilege | null {
  const name = request.name.toLowerCase();
  if (name.startsWith("channel.tool.")) return "approval.channel";
  if (["config", "configedit", "configdelete"].includes(name)) return "approval.config";
  if (
    ["edit", "write", "multiedit", "notebookedit", "todowrite", "codexfilechange"].includes(name)
  ) {
    return "approval.file";
  }
  if (["read", "readfile", "codexfileread"].includes(name)) return "approval.file";

  const command = commandOf(request);
  if (
    name === "codexbash" ||
    ["bash", "shell", "terminal", "exec", "execute_command"].includes(name) ||
    command !== null
  ) {
    return command && isDestructiveCommand(command)
      ? "approval.command.destructive"
      : "approval.command";
  }
  return null;
}

function commandOf(request: {
  input?: Record<string, unknown>;
  detail?: { type: string; command?: string };
}): string | null {
  if (request.detail?.type === "shell" && typeof request.detail.command === "string") {
    return request.detail.command;
  }
  for (const key of ["command", "cmd", "script"] as const) {
    const value = request.input?.[key];
    if (typeof value === "string") return value;
  }
  return null;
}

const DESTRUCTIVE_COMMAND_PATTERNS: readonly RegExp[] = [
  /\brm\s+(?:-[a-z]+\s+)*-[a-z]*[rR][a-z]*f[a-z]*\s+/iu,
  /\brm\s+(?:-[a-z]+\s+)*-[a-z]*f[a-z]*[rR][a-z]*\s+/iu,
  /\bfind\b[^\n|;&]*\s-delete\b/iu,
  /\bmkfs(\.\w+)?\b/iu,
  /\b(shutdown|reboot|halt|poweroff)\b/iu,
  /\bgit\s+push\b[^\n|;&]*--force\b/iu,
  /\bgit\s+reset\s+--hard\b/iu,
  /\bgit\s+clean\b[^\n|;&]*-[a-z]*f/iu,
];

function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}
