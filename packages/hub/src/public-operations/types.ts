import type { ApiKeyScope } from "../auth/api-key-contract.js";
import type { HubBundleFile } from "../config/bundle.js";
import type { TriggerRunRecord } from "../db/types.js";
import type { DeploymentProjectResolution } from "../project-deployments/index.js";

export interface PublicAuthorization {
  kind: "apiKey" | "cliCredential";
  credentialId: string;
  organizationId: string;
  scopes: readonly ApiKeyScope[];
}

export interface InstallConfigurationInput {
  projectSlug?: string | undefined;
  files: readonly HubBundleFile[];
}

export type ValidateConfigurationInput = InstallConfigurationInput;

export type ValidateConfigurationResult =
  | { status: "valid"; projectSlug: string; valid: true; wouldCreateProject?: true }
  | { status: "project_not_found" }
  | { status: "invalid_bundle"; issues: readonly DomainIssue[] }
  | { status: "invalid_configuration"; issues: readonly DomainIssue[] }
  | InfrastructureUnavailable;

export interface PublicProject {
  id: string;
  name: string;
  slug: string;
}

export type ListProjectsResult =
  | { status: "listed"; projects: readonly PublicProject[] }
  | InfrastructureUnavailable;

export interface ConfigurationResources {
  daemons: readonly { id: string; slug: string }[];
  github: readonly {
    slug: string;
    accountLogin: string;
    accountType: string;
    repositories: readonly string[];
  }[];
  discord: readonly { slug: string; guildName: string }[];
  slack: readonly { slug: string; teamName: string }[];
}

export type ListConfigurationResourcesResult =
  | ({ status: "listed" } & ConfigurationResources)
  | InfrastructureUnavailable;

export interface SetupResources {
  github: readonly {
    slug: string;
    accountLogin: string;
    accountType: string;
    repositories: readonly string[];
  }[];
  discord: readonly { guildId: string; guildName: string }[];
  slack: readonly { teamId: string; teamName: string }[];
}

export type ListSetupResourcesResult =
  | ({ status: "listed" } & SetupResources)
  | InfrastructureUnavailable;

export type InstallConfigurationResult =
  | {
      status: "installed";
      projectSlug: string;
      versionId: string;
      version: number;
      active: true;
    }
  | { status: "project_not_found" }
  | { status: "invalid_bundle"; issues: readonly DomainIssue[] }
  | {
      status: "invalid_configuration";
      versionId: string;
      issues: readonly DomainIssue[];
    }
  | InfrastructureUnavailable;

export interface DispatchManualRunInput {
  projectSlug: string;
  expectedVersionId?: string | undefined;
  trigger: string;
  actor: string;
  deliveryKey: string;
  input: unknown;
}

export type DispatchManualRunResult =
  | {
      status: "dispatched";
      deliveryKey: string;
      providerEventReceiptId: string;
      triggerRunId: string;
      configuredTriggerName: string;
      workflowStatus: "running" | "succeeded" | "failed" | "timed_out";
    }
  | { status: "project_not_found" }
  | { status: "actor_forbidden" }
  | { status: "daemon_offline" }
  | { status: "expected_configuration_not_current" }
  | { status: "configuration_not_found" }
  | { status: "trigger_not_found" }
  | {
      status: "invalid_input";
      providerEventReceiptId: string;
      triggerRunId: string;
      configuredTriggerName: string;
      issues: readonly DomainIssue[];
    }
  | { status: "dispatch_conflict" }
  | InfrastructureUnavailable;

export type IssueEnrollmentTokenResult =
  | { status: "issued"; token: string; expiresAt: Date }
  | { status: "credential_revoked" }
  | InfrastructureUnavailable;

export interface DomainIssue {
  path: readonly (string | number)[];
  message: string;
}

export interface InfrastructureUnavailable {
  status: "infrastructure_unavailable";
}

export interface PublicOperations {
  listProjects(authorization: PublicAuthorization): Promise<ListProjectsResult>;
  listConfigurationResources(
    authorization: PublicAuthorization,
  ): Promise<ListConfigurationResourcesResult>;
  listSetupResources(authorization: PublicAuthorization): Promise<ListSetupResourcesResult>;
  validateConfiguration(
    authorization: PublicAuthorization,
    input: ValidateConfigurationInput,
  ): Promise<ValidateConfigurationResult>;
  installConfiguration(
    authorization: PublicAuthorization,
    input: InstallConfigurationInput,
  ): Promise<InstallConfigurationResult>;
  dispatchManualRun(
    authorization: PublicAuthorization,
    input: DispatchManualRunInput,
  ): Promise<DispatchManualRunResult>;
  issueEnrollmentToken(authorization: PublicAuthorization): Promise<IssueEnrollmentTokenResult>;
}

export interface PublicOperationRepository {
  listActiveProjects(organizationId: string): Promise<readonly PublicProject[]>;
  listConfigurationResources(organizationId: string): Promise<ConfigurationResources>;
  listSetupResources(organizationId: string): Promise<SetupResources>;
  findActiveProject(
    organizationId: string,
    projectSlug: string,
  ): Promise<{ id: string; slug: string } | undefined>;
  resolveDeploymentProject(input: {
    organizationId: string;
    explicitProjectSlug?: string | undefined;
    bundleName?: string | undefined;
    dryRun: boolean;
  }): Promise<DeploymentProjectResolution>;
  findManualRun(
    providerEventReceiptId: string,
    trigger: string,
  ): Promise<TriggerRunRecord | undefined>;
  issueEnrollmentToken(
    authorization: PublicAuthorization,
    input: { token: string; expiresAt: Date },
  ): Promise<"issued" | "credential_revoked" | "infrastructure_unavailable">;
}

export interface PublicOperationCapabilities {
  configurationForProject(projectId: string): {
    validateBundle(
      files: readonly HubBundleFile[],
    ): Promise<{ valid: true } | { valid: false; validationErrors: unknown }>;
    insertManualBundleRevision(input: {
      files: readonly HubBundleFile[];
      userId: null;
      sourceEvidence: {
        kind: "api-key" | "cli-credential";
        credentialId: string;
      };
    }): Promise<{ id: string; validationErrors: unknown }>;
    activate(id: string): Promise<{ revision: { id: string; version: number } }>;
  };
  validateBundleForOrganization(
    organizationId: string,
    files: readonly HubBundleFile[],
  ): Promise<{ valid: true } | { valid: false; validationErrors: unknown }>;
  dispatchManualEvent(input: {
    organizationId: string;
    projectId: string;
    source: "manual.run";
    deliveryId: string;
    receivedAt: Date;
    payload: unknown;
  }): Promise<{ providerEventReceiptId: string } | void>;
}
