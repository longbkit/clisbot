import type { DaemonPermission } from "../authorization/index.js";
import type { ManagedAccessMode as ProtocolManagedAccessMode } from "@getpaseo/protocol/managed-access";

export type ManagedAccessMode = ProtocolManagedAccessMode;

export const PROJECT_PRIVILEGES = [
  "project.use",
  "workspace.create",
  "agent.interact",
  "agent.create",
  "agent.fast.use",
  "terminal.use",
  "approval.file",
  "approval.config",
  "approval.command",
  "approval.command.destructive",
  "approval.channel",
] as const;
export type ProjectPrivilege = (typeof PROJECT_PRIVILEGES)[number];

export interface ResolvedAgentConfigurationGrant {
  providerId: string;
  modelIds: "*" | readonly string[];
  thinkingOptionIds: "*" | readonly string[];
}

export interface ProjectAuthorization {
  privileges: ReadonlySet<ProjectPrivilege>;
  agentConfigurations: readonly ResolvedAgentConfigurationGrant[];
}

export interface SessionResourceAuthorization {
  resourceMode: "daemon" | "projects";
  projects: ReadonlyMap<string, ProjectAuthorization>;
  leaseId: string;
  leaseExpiresAt: number;
}

/** Hub-resolved authority. The daemon evaluates exact leaves, never Hub roles. */
export interface ManagedAccessAdmission extends SessionResourceAuthorization {
  principalId: string;
  permissions: readonly DaemonPermission[];
}

export interface ManagedAccessAdmissionRequest {
  accessTicket: string;
  clientId: string;
  transport: "direct" | "relay";
  peer: "loopback" | "external";
}

export interface ManagedAccessAdmissionResolver {
  resolve(request: ManagedAccessAdmissionRequest): Promise<ManagedAccessAdmission>;
  refresh?(leaseId: string): Promise<ManagedAccessAdmission>;
}
