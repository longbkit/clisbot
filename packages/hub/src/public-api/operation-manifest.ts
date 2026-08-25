import type { ApiKeyScope } from "../auth/api-key-contract.js";
import type {
  DispatchManualRunResult,
  InstallConfigurationResult,
  IssueEnrollmentTokenResult,
  ListConfigurationResourcesResult,
  ListSetupResourcesResult,
  ListProjectsResult,
  PublicOperations,
  ValidateConfigurationResult,
} from "../public-operations/index.js";
import {
  DispatchManualRunRequestSchema,
  DispatchedManualRunSchema,
  EnrollmentTokenSchema,
  InstallConfigurationRequestSchema,
  InstalledConfigurationSchema,
  ProjectListSchema,
  ConfigurationResourcesSchema,
  SetupResourcesSchema,
  ValidatedConfigurationSchema,
} from "./contracts.js";

export type PublicOperationId =
  | "listProjects"
  | "listConfigurationResources"
  | "listSetupResources"
  | "validateConfiguration"
  | "installConfiguration"
  | "dispatchManualRun"
  | "issueEnrollmentToken";

export interface PublicOperationDefinition {
  id: PublicOperationId;
  method: "get" | "post";
  path: string;
  scope: ApiKeyScope;
  requestSchema?: typeof InstallConfigurationRequestSchema | typeof DispatchManualRunRequestSchema;
  successSchema:
    | typeof InstalledConfigurationSchema
    | typeof ValidatedConfigurationSchema
    | typeof ProjectListSchema
    | typeof ConfigurationResourcesSchema
    | typeof SetupResourcesSchema
    | typeof DispatchedManualRunSchema
    | typeof EnrollmentTokenSchema;
  successStatus: 200 | 201;
  resultMapping:
    | "projects"
    | "configuration-resources"
    | "setup-resources"
    | "validation"
    | "configuration"
    | "manual-run"
    | "enrollment-token";
  summary: string;
  description: string;
  tag: "Projects" | "Configurations" | "Runs" | "Daemons";
  responses: Readonly<Record<number, string>>;
  invoke(
    operations: PublicOperations,
    authorization: Parameters<PublicOperations["issueEnrollmentToken"]>[0],
    input: unknown,
  ): Promise<
    | ListProjectsResult
    | ListConfigurationResourcesResult
    | ListSetupResourcesResult
    | ValidateConfigurationResult
    | InstallConfigurationResult
    | DispatchManualRunResult
    | IssueEnrollmentTokenResult
  >;
}

export const publicOperationManifest: readonly PublicOperationDefinition[] = [
  {
    id: "listProjects",
    method: "get",
    path: "/api/v1/projects",
    scope: "projects:read",
    successSchema: ProjectListSchema,
    successStatus: 200,
    resultMapping: "projects",
    summary: "List projects",
    description: "Lists active projects in the authenticated organization.",
    tag: "Projects",
    responses: {
      200: "The organization's active projects.",
      401: "The bearer credential is missing, malformed, or revoked.",
      403: "The bearer credential lacks projects:read.",
      500: "The operation failed unexpectedly.",
      503: "Hub authentication or storage is unavailable.",
    },
    invoke: (operations, authorization) => operations.listProjects(authorization),
  },
  {
    id: "listConfigurationResources",
    method: "get",
    path: "/api/v1/configuration-resources",
    scope: "configuration:validate",
    successSchema: ConfigurationResourcesSchema,
    successStatus: 200,
    resultMapping: "configuration-resources",
    summary: "List configuration resources",
    description:
      "Lists organization daemon and provider slugs that configuration validation resolves.",
    tag: "Configurations",
    responses: {
      200: "The organization's configuration resources.",
      401: "The bearer credential is missing, malformed, or revoked.",
      403: "The bearer credential lacks configuration:validate.",
      500: "The operation failed unexpectedly.",
      503: "Hub authentication or storage is unavailable.",
    },
    invoke: (operations, authorization) => operations.listConfigurationResources(authorization),
  },
  {
    id: "listSetupResources",
    method: "get",
    path: "/api/v1/setup-resources",
    scope: "configuration:validate",
    successSchema: SetupResourcesSchema,
    successStatus: 200,
    resultMapping: "setup-resources",
    summary: "List setup resources",
    description:
      "Lists provider-native identifiers and labels needed to author starter workflow filters.",
    tag: "Configurations",
    responses: {
      200: "The organization's setup resources.",
      401: "The bearer credential is missing, malformed, or revoked.",
      403: "The bearer credential lacks configuration:validate.",
      500: "The operation failed unexpectedly.",
      503: "Hub authentication or storage is unavailable.",
    },
    invoke: (operations, authorization) => operations.listSetupResources(authorization),
  },
  {
    id: "validateConfiguration",
    method: "post",
    path: "/api/v1/configurations/validate",
    scope: "configuration:validate",
    requestSchema: InstallConfigurationRequestSchema,
    successSchema: ValidatedConfigurationSchema,
    successStatus: 200,
    resultMapping: "validation",
    summary: "Validate configuration",
    description:
      "Resolves the deployment project and validates the same YAML, prompt-partial bundle, daemon, and provider resources as installation without creating a project, recording a revision, or changing active configuration.",
    tag: "Configurations",
    responses: {
      200: "The configuration is valid for the project.",
      400: "The JSON request is malformed or has invalid fields.",
      401: "The bearer credential is missing, malformed, or revoked.",
      403: "The bearer credential lacks configuration:validate.",
      404: "The project does not exist in the credential's organization.",
      422: "The YAML, supplied prompt partial bundle, or Hub configuration is invalid.",
      500: "The operation failed unexpectedly.",
      503: "Hub authentication or storage is unavailable.",
    },
    invoke: (operations, authorization, input) =>
      operations.validateConfiguration(
        authorization,
        InstallConfigurationRequestSchema.parse(input),
      ),
  },
  {
    id: "installConfiguration",
    method: "post",
    path: "/api/v1/configurations/install",
    scope: "configuration:install",
    requestSchema: InstallConfigurationRequestSchema,
    successSchema: InstalledConfigurationSchema,
    successStatus: 201,
    resultMapping: "configuration",
    summary: "Install and activate configuration",
    description:
      "Resolves or creates the deployment project, validates the complete canonical Hub bundle, records a configuration revision, and atomically activates it.",
    tag: "Configurations",
    responses: {
      201: "The new configuration revision is active.",
      400: "The JSON request is malformed or has invalid fields.",
      401: "The bearer credential is missing, malformed, or revoked.",
      403: "The bearer credential lacks configuration:install.",
      404: "The project does not exist in the credential's organization.",
      422: "The YAML, supplied prompt partial bundle, or Hub configuration is invalid.",
      500: "The operation failed unexpectedly.",
      503: "Hub authentication or storage is unavailable.",
    },
    invoke: (operations, authorization, input) =>
      operations.installConfiguration(
        authorization,
        InstallConfigurationRequestSchema.parse(input),
      ),
  },
  {
    id: "dispatchManualRun",
    method: "post",
    path: "/api/v1/manual-runs",
    scope: "runs:dispatch",
    requestSchema: DispatchManualRunRequestSchema,
    successSchema: DispatchedManualRunSchema,
    successStatus: 200,
    resultMapping: "manual-run",
    summary: "Dispatch a manual run",
    description:
      "Uses deliveryKey as caller-supplied request identity in the existing durable manual-event path.",
    tag: "Runs",
    responses: {
      200: "The durable manual event resolved to a run.",
      400: "The JSON request or trigger input is invalid.",
      401: "The bearer credential is missing, malformed, or revoked.",
      403: "The bearer credential lacks runs:dispatch or the actor is forbidden.",
      404: "The project, configuration, or manual trigger does not exist.",
      409: "The existing manual event path could not resolve a run.",
      500: "The operation failed unexpectedly.",
      503: "Hub authentication or storage is unavailable.",
    },
    invoke: (operations, authorization, input) =>
      operations.dispatchManualRun(authorization, DispatchManualRunRequestSchema.parse(input)),
  },
  {
    id: "issueEnrollmentToken",
    method: "post",
    path: "/api/v1/daemons/enrollment-tokens",
    scope: "daemons:enroll",
    successSchema: EnrollmentTokenSchema,
    successStatus: 201,
    resultMapping: "enrollment-token",
    summary: "Issue a daemon enrollment token",
    description: "Returns a short-lived, single-use token for enrolling one daemon.",
    tag: "Daemons",
    responses: {
      201: "A short-lived enrollment token was issued.",
      401: "The bearer credential is missing, malformed, or revoked.",
      403: "The bearer credential lacks daemons:enroll.",
      500: "The operation failed unexpectedly.",
      503: "Hub authentication or storage is unavailable.",
    },
    invoke: (operations, authorization) => operations.issueEnrollmentToken(authorization),
  },
];

export function publicOperation(id: PublicOperationId): PublicOperationDefinition {
  const definition = publicOperationManifest.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`unknown public operation: ${id}`);
  return definition;
}
