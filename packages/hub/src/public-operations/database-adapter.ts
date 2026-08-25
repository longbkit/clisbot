import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../db/types.js";
import { DeploymentProjects } from "../project-deployments/index.js";
import type { PublicOperationRepository } from "./types.js";

export function createDatabasePublicOperationRepository(
  database: Database,
): PublicOperationRepository {
  const deploymentProjects = new DeploymentProjects(database);
  return {
    async listActiveProjects(organizationId) {
      return (await database.listProjectsForOrganization(organizationId))
        .filter((project) => project.status === "active")
        .map(({ id, name, slug }) => ({ id, name, slug }));
    },
    async listConfigurationResources(organizationId) {
      const [{ connections, repositories }, daemons] = await Promise.all([
        providerResources(database, organizationId),
        database.listDaemonsForOrganization(organizationId),
      ]);
      return {
        daemons: daemons
          .filter(({ status }) => status === "active")
          .map(({ id, slug }) => ({ id, slug })),
        github: connections.github.map(({ id, slug, accountLogin, accountType }) => ({
          slug,
          accountLogin,
          accountType,
          repositories: repositories
            .filter(({ connectionId }) => connectionId === id)
            .map(({ fullName }) => fullName),
        })),
        discord: connections.discord.map(({ slug, guildName }) => ({ slug, guildName })),
        slack: connections.slack.map(({ slug, teamName }) => ({ slug, teamName })),
      };
    },
    async listSetupResources(organizationId) {
      const { connections, repositories } = await providerResources(database, organizationId);
      return {
        github: connections.github.map(({ id, slug, accountLogin, accountType }) => ({
          slug,
          accountLogin,
          accountType,
          repositories: repositories
            .filter(({ connectionId }) => connectionId === id)
            .map(({ fullName }) => fullName),
        })),
        discord: connections.discord.map(({ guildId, guildName }) => ({ guildId, guildName })),
        slack: connections.slack.map(({ teamId, teamName }) => ({ teamId, teamName })),
      };
    },
    async findActiveProject(organizationId, projectSlug) {
      const project = await database.findProjectBySlugForOrganization(organizationId, projectSlug);
      return project === undefined || project.status !== "active"
        ? undefined
        : { id: project.id, slug: project.slug };
    },
    resolveDeploymentProject: (input) => deploymentProjects.resolve(input),
    async findManualRun(providerEventReceiptId, trigger) {
      return (await database.findTriggerRunsByProviderEventReceiptId(providerEventReceiptId)).find(
        (candidate) => candidate.configuredTriggerName === trigger,
      );
    },
    async issueEnrollmentToken(authorization, input) {
      const issued = await database.issueEnrollmentToken({
        id: randomUUID(),
        verifier: createHash("sha256").update(input.token).digest("base64url"),
        organizationId: authorization.organizationId,
        ...(authorization.kind === "apiKey"
          ? { issuedByApiKeyId: authorization.credentialId }
          : { issuedByCliCredentialId: authorization.credentialId }),
        expiresAt: input.expiresAt,
        consumedAt: null,
      });
      return issued ? "issued" : "credential_revoked";
    },
  };
}

async function providerResources(database: Database, organizationId: string) {
  const [connections, repositories] = await Promise.all([
    database.organizationConnectionUsage(organizationId),
    database.listGitHubRepositories(organizationId),
  ]);
  return { connections, repositories };
}
