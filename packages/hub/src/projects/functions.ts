import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  MAX_PROMPT_PARTIAL_CONTENT_BYTES,
  MAX_PROMPT_PARTIAL_COUNT,
  MAX_PROMPT_PARTIAL_PATH_LENGTH,
} from "../config/prompt-partial-limits.js";
import { respondOk, type Result } from "../contract/respond.js";
import { getApplication } from "../server/runtime.js";
import { respondWithFailure } from "../failures/index.js";
import { projectSlugSchema } from "../project-slug.js";
import { isTenantRouteNotFoundError } from "./access.js";
import { ProjectCommandError, projectCommandErrorCode } from "./command-error.js";
import { type ManualConfigurationSaveResult, type ProjectDashboard } from "./dashboard.js";

const organizationScopeSchema = z
  .object({ organizationSlug: z.string().trim().min(1).max(100) })
  .strict();
const projectScopeSchema = organizationScopeSchema
  .extend({ projectSlug: z.string().trim().min(1).max(100) })
  .strict();
const activityRunScopeSchema = projectScopeSchema.extend({ runId: z.string().uuid() }).strict();
const createProjectSchema = organizationScopeSchema.extend({
  name: z.string().trim().min(1).max(100),
  slug: projectSlugSchema,
});
const projectUpdateSchema = projectScopeSchema.extend({
  slug: projectSlugSchema,
});
const configurationRepositorySchema = projectScopeSchema.extend({
  connectionId: z.string().uuid(),
  repositoryId: z.number().int().positive(),
});
const manualConfigurationSchema = projectScopeSchema.extend({
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(MAX_PROMPT_PARTIAL_PATH_LENGTH),
        content: z.string().max(MAX_PROMPT_PARTIAL_CONTENT_BYTES),
      }),
    )
    .max(MAX_PROMPT_PARTIAL_COUNT),
});

export const tenantContext = createServerFn({ method: "GET" })
  .validator(
    organizationScopeSchema.extend({ projectSlug: z.string().trim().min(1).max(100).optional() }),
  )
  .handler(
    async ({ data }): Promise<Result<Awaited<ReturnType<ProjectDashboard["tenantContext"]>>>> =>
      read(data, (dashboard) => dashboard.tenantContext(getRequest(), data)),
  );

export const organizationSnapshot = createServerFn({ method: "GET" })
  .validator(organizationScopeSchema)
  .handler(
    async ({
      data,
    }): Promise<Result<Awaited<ReturnType<ProjectDashboard["organizationSnapshot"]>>>> =>
      read(data, (dashboard) => dashboard.organizationSnapshot(getRequest(), data)),
  );

export const projectSnapshot = createServerFn({ method: "GET" })
  .validator(projectScopeSchema)
  .handler(
    async ({ data }): Promise<Result<Awaited<ReturnType<ProjectDashboard["projectSnapshot"]>>>> =>
      read(data, (dashboard) => dashboard.projectSnapshot(getRequest(), data)),
  );

export const activityRunSnapshot = createServerFn({ method: "GET" })
  .validator(activityRunScopeSchema)
  .handler(
    async ({
      data,
    }): Promise<Result<Awaited<ReturnType<ProjectDashboard["activityRunSnapshot"]>>>> =>
      read(data, (dashboard) => dashboard.activityRunSnapshot(getRequest(), data)),
  );

export const createProject = createServerFn({ method: "POST" })
  .validator(createProjectSchema)
  .handler(async ({ data }) =>
    command(data, (dashboard) =>
      dashboard.createProject(getRequest(), data, { name: data.name, slug: data.slug }),
    ),
  );

export const archiveProject = createServerFn({ method: "POST" })
  .validator(projectScopeSchema)
  .handler(async ({ data }) =>
    command(data, (dashboard) => dashboard.archiveProject(getRequest(), data)),
  );

export const updateProjectSlug = createServerFn({ method: "POST" })
  .validator(projectUpdateSchema)
  .handler(async ({ data }) =>
    command(data, (dashboard) => dashboard.updateProjectSlug(getRequest(), data, data.slug)),
  );

export const availableGitHubRepositories = createServerFn({ method: "GET" })
  .validator(projectScopeSchema)
  .handler(async ({ data }) =>
    read(data, (dashboard) => dashboard.availableGitHubRepositories(getRequest(), data)),
  );

export const useGitHubConfiguration = createServerFn({ method: "POST" })
  .validator(configurationRepositorySchema)
  .handler(async ({ data }) =>
    command(data, (dashboard) =>
      dashboard.useGitHubConfiguration(getRequest(), data, {
        connectionId: data.connectionId,
        repositoryId: data.repositoryId,
      }),
    ),
  );

export const switchConfigurationToManual = createServerFn({ method: "POST" })
  .validator(projectScopeSchema)
  .handler(async ({ data }) =>
    command(data, (dashboard) => dashboard.switchConfigurationToManual(getRequest(), data)),
  );

export const saveManualConfiguration = createServerFn({ method: "POST" })
  .validator(manualConfigurationSchema)
  .handler(
    async ({ data }): Promise<Result<ManualConfigurationSaveResult>> =>
      commandResult(data, (dashboard) =>
        dashboard.saveManualConfiguration(getRequest(), data, { files: data.files }),
      ),
  );

export const syncProjectConfiguration = createServerFn({ method: "POST" })
  .validator(projectScopeSchema)
  .handler(async ({ data }) =>
    command(data, (dashboard) => dashboard.syncConfiguration(getRequest(), data)),
  );

async function read<T>(
  scope: { organizationSlug: string; projectSlug?: string | undefined },
  operation: (dashboard: ProjectDashboard) => Promise<T>,
): Promise<Result<T>> {
  try {
    return respondOk(await operation(await requireDashboard()));
  } catch (error) {
    const message = readUnavailableMessage(error, scope.projectSlug !== undefined);
    return respondWithFailure(error, projectFailureContext("project.read", scope), {
      fallback: message,
      notFound: message,
      forbidden: message,
    });
  }
}

async function command<T>(
  scope: { organizationSlug: string; projectSlug?: string | undefined },
  operation: (dashboard: ProjectDashboard) => Promise<T>,
): Promise<Result<{ state: "complete" }>> {
  return commandResult(scope, async (dashboard) => {
    await operation(dashboard);
    return { state: "complete" } as const;
  });
}

async function commandResult<T>(
  scope: { organizationSlug: string; projectSlug?: string | undefined },
  operation: (dashboard: ProjectDashboard) => Promise<T>,
): Promise<Result<T>> {
  try {
    return respondOk(await operation(await requireDashboard()));
  } catch (error) {
    const forbidden = commandForbiddenMessage(error);
    const message = forbidden ?? unavailableMessage(error, scope.projectSlug !== undefined);
    return respondWithFailure(error, projectFailureContext("project.command", scope), {
      fallback: message,
      notFound: message,
      forbidden: message,
      conflict: message,
      validation: message,
    });
  }
}

function projectFailureContext(
  operation: string,
  scope: { organizationSlug: string; projectSlug?: string | undefined },
) {
  return {
    operation,
    component: "projects",
    organizationSlug: scope.organizationSlug,
    ...(scope.projectSlug === undefined ? {} : { projectSlug: scope.projectSlug }),
  } as const;
}

async function requireDashboard(): Promise<ProjectDashboard> {
  return (await getApplication()).projectDashboard ?? unavailable();
}

function unavailable(): never {
  throw new ProjectCommandError("dashboard_unavailable");
}

export function unavailableMessage(error: unknown, projectScoped: boolean): string {
  if (isTenantRouteNotFoundError(error)) {
    return projectScoped ? "Project unavailable." : "Organization unavailable.";
  }
  return projectScoped
    ? "Hub couldn't update this project. Reload its current state before submitting again."
    : "Hub couldn't update this organization. Reload its current state before submitting again.";
}

export function readUnavailableMessage(error: unknown, projectScoped: boolean): string {
  if (isTenantRouteNotFoundError(error)) {
    return projectScoped ? "Project unavailable." : "Organization unavailable.";
  }
  return projectScoped
    ? "Hub couldn't load this project's configuration. Reload the page to try again."
    : "Hub couldn't load this organization. Reload the page to try again.";
}

export function commandForbiddenMessage(error: unknown): string | undefined {
  return projectCommandErrorCode(error) === "forbidden"
    ? "You don't have permission to manage this project."
    : undefined;
}
