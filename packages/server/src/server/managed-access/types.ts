import type { DaemonPermission } from "../authorization/index.js";
import type { ManagedAccessMode as ProtocolManagedAccessMode } from "@getpaseo/protocol/managed-access";
// One definition of the product privilege vocabulary, shared with the Hub via a
// pure fusion protocol module (build-time reuse, not a wire contract).
import {
  PROJECT_PRIVILEGES,
  type ProjectPrivilege,
} from "@getpaseo/protocol/managed-access-privileges";

export type ManagedAccessMode = ProtocolManagedAccessMode;

export { PROJECT_PRIVILEGES, type ProjectPrivilege };

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
