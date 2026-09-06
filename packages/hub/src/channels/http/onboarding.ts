import { conflict, invalidRequest } from "./problems.js";
// Local operator onboarding composes existing enrollment, Channel revisions and
// verified Member identities. Authentication stays in the control-plane gate.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dump, load } from "js-yaml";
import { z } from "zod";
import type { Database } from "../../db/types.js";
import type { DatabaseRuntime } from "../../db/runtime/index.js";
import type { AccessStore } from "../../access/store.js";
import type { HubBundleFile } from "../../config/bundle-contract.js";
import { AccountFileSchema } from "../config/schema.js";

export const ChannelOnboardingSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    update: z.boolean().optional(),
    daemonId: z.string().uuid(),
    projectId: z.string().min(1),
    cwd: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    mode: z.string().min(1).optional(),
    ownerEmail: z.string().email().optional(),
    ownerIdentity: z.string().min(1).optional(),
  })
  .strict();
export type ChannelOnboarding = z.infer<typeof ChannelOnboardingSchema>;

export interface OnboardingServices {
  runtime: DatabaseRuntime;
  access: AccessStore;
  providerApplications?: import("../../provider-applications/index.js").ProviderApplications;
}

export async function onboardingOwner(
  services: OnboardingServices,
  organizationId: string,
  email?: string,
) {
  const result = await services.runtime.query<{ id: string; user_id: string; email: string }>(
    `select m.id, m.user_id, u.email from member m join "user" u on u.id = m.user_id
     where m.organization_id = $1 and m.role = 'owner'
       and ($2::text is null or lower(u.email) = lower($2))`,
    [organizationId, email ?? null],
  );
  if (result.rows.length !== 1) {
    throw conflict(
      "Select the existing organization owner with --owner-email; finish Account setup if no owner exists.",
    );
  }
  return result.rows[0]!;
}

export async function prepareChannelOnboarding(
  database: Database,
  services: OnboardingServices,
  email?: string,
) {
  const organizations = await database.listOrganizationsForOperator();
  if (organizations.length !== 1)
    throw conflict(
      "Finish Account setup on the local Hub first; onboarding requires one organization.",
    );
  const organization = organizations[0]!;
  const owner = await onboardingOwner(services, organization.id, email);
  const token = randomBytes(32).toString("base64url");
  await database.issueEnrollmentToken({
    id: randomUUID(),
    organizationId: organization.id,
    verifier: createHash("sha256").update(token).digest("base64url"),
    expiresAt: new Date(Date.now() + 5 * 60_000),
    consumedAt: null,
  });
  return { organizationId: organization.id, ownerEmail: owner.email, enrollmentToken: token };
}

/** Preserve unrelated accounts/resources; the named bot owns only its generated routes. */
export function configureOnboardingRoute(
  files: readonly HubBundleFile[],
  channel: string,
  accountId: string,
  input: ChannelOnboarding,
): HubBundleFile[] {
  const key = `bot-${input.name}`;
  const resourceFile = configureOnboardingResources(files, key, input);
  const accountPath = `.paseo/channels/${channel}/${accountId}.yml`;
  const account = AccountFileSchema.parse(
    load(files.find(({ path }) => path === accountPath)!.content),
  );
  const retained = (account.routes ?? []).filter(
    (route) => route.agent !== key || route.environment !== key,
  );
  const kinds =
    channel === "telegram"
      ? (["dm", "group", "topic"] as const)
      : (["dm", "channel", "thread"] as const);
  if (retained.length === (account.routes ?? []).length)
    account.routes = [
      ...retained,
      ...kinds.map((kind) => ({
        match: { kind },
        audience: { kind: "members" as const },
        agent: key,
        environment: key,
        interaction: { requireMention: kind !== "dm" },
        reply: channel === "slack" && kind !== "dm" ? { anchor: "thread" as const } : undefined,
        sync: { finalAnswers: true },
      })),
    ];
  return [
    ...files.filter(({ path }) => path !== resourceFile.path && path !== accountPath),
    resourceFile,
    { path: accountPath, content: dump(account, { lineWidth: -1 }) },
  ];
}

function configureOnboardingResources(
  files: readonly HubBundleFile[],
  key: string,
  input: ChannelOnboarding,
): HubBundleFile {
  const resourcePath = ".paseo/hub.yml";
  const resourceFile = files.find(({ path }) => path === resourcePath);
  const resource = z
    .record(z.string(), z.unknown())
    .parse(resourceFile ? load(resourceFile.content) : {});
  const environments = z.record(z.string(), z.unknown()).parse(resource["environments"] ?? {});
  const agents = z.record(z.string(), z.unknown()).parse(resource["agents"] ?? {});
  if (environments[key] === undefined || input.update)
    environments[key] = {
      kind: "daemon",
      daemon: input.daemonId,
      projectId: input.projectId,
      cwd: input.cwd,
    };
  if (agents[key] === undefined || input.update)
    agents[key] = {
      provider: input.provider,
      ...(input.model ? { model: input.model } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
    };
  return {
    path: resourcePath,
    content: dump({ ...resource, environments, agents }, { lineWidth: -1 }),
  };
}

export async function linkOnboardingOwner(
  services: OnboardingServices,
  organizationId: string,
  connectionId: string,
  input: ChannelOnboarding,
): Promise<{ ready: boolean; command?: string; expiresAt?: string }> {
  const owner = await onboardingOwner(services, organizationId, input.ownerEmail);
  const identities = await services.access.listChannelIdentities(organizationId);
  if (
    input.ownerIdentity &&
    identities.some(
      (identity) =>
        identity.connectionId === connectionId &&
        identity.externalSubjectId === input.ownerIdentity &&
        identity.memberId !== owner.id,
    )
  ) {
    throw conflict(
      "This channel identity already belongs to another Member. Update verified identities in Hub before assigning it to this owner.",
    );
  }
  if (input.ownerIdentity) {
    await services.access.bindChannelIdentity({
      organizationId,
      memberId: owner.id,
      connectionId,
      externalSubjectId: input.ownerIdentity,
      displayName: null,
      verificationMethod: "administrator",
      verifiedByUserId: owner.user_id,
    });
  }
  if (
    input.ownerIdentity ||
    identities.some(
      (identity) => identity.memberId === owner.id && identity.connectionId === connectionId,
    )
  ) {
    return { ready: true };
  }
  const challenge = await services.access.issueChannelIdentityChallenge({
    organizationId,
    userId: owner.user_id,
    membershipId: owner.id,
    connectionId,
  });
  return { ready: false, command: challenge.command, expiresAt: challenge.expiresAt.toISOString() };
}

export async function configureOnboardingSlack(
  database: Database,
  services: OnboardingServices,
  request: Request,
  organizationId: string,
  input: { botToken: string; appToken: string; ownerEmail?: string },
): Promise<string> {
  const configure = services.providerApplications?.configureLocalSlackSocket;
  if (!configure) throw conflict("Slack setup is unavailable on this Hub");
  const owner = await onboardingOwner(services, organizationId, input.ownerEmail);
  const result = await configure(request, { userId: owner.user_id, organizationId }, input);
  const connections = (await database.organizationConnectionUsage(organizationId)).slack;
  const connection = connections.find(
    (entry) =>
      entry.providerApplicationId === result.identity.id && entry.botAccessToken === input.botToken,
  );
  if (!connection) throw conflict("The verified Slack Connection is unavailable");
  return connection.id;
}

export async function validateOnboardingTarget(
  database: Database,
  services: OnboardingServices | undefined,
  organizationId: string,
  input: ChannelOnboarding,
): Promise<void> {
  if (!services) throw conflict("Local onboarding services are unavailable");
  await onboardingOwner(services, organizationId, input.ownerEmail);
  const daemon = await database.findDaemonForOrganization(organizationId, input.daemonId);
  if (!daemon || daemon.status !== "active")
    throw invalidRequest("The onboarding daemon is not enrolled in this organization");
}
