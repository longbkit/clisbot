import type { BotPayload } from "@clisbot/protocol/bots/types";
import { ProductRequestError } from "../../auth/organization-access.js";
import { conflict, invalidRequest } from "./problems.js";
// Local operator onboarding composes existing enrollment, Channel revisions and
// verified Member identities. Authentication stays in the control-plane gate.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dump, load } from "js-yaml";
import { z } from "zod";
import type { Database } from "../../db/types.js";
import type { DatabaseRuntime } from "../../db/runtime/index.js";
import type { AccessStore } from "../../access/store.js";
import {
  CHANNEL_RESOURCE_PATH,
  CHANNELS_DIRECTORY,
  type HubBundleFile,
} from "../../config/bundle-contract.js";
import { AccountFileSchema } from "../config/schema.js";

export const ChannelOnboardingSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .refine((value) => !value.includes("/") && !value.includes("\\") && !value.includes("\0")),
    botId: z
      .string()
      .regex(/^bot_[0-9a-f]{16}$/)
      .optional(),
    update: z.boolean().optional(),
    daemonId: z.string().uuid(),
    projectId: z.string().min(1),
    cwd: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    mode: z.string().min(1).optional(),
    ownerEmail: z.string().email().optional(),
    ownerMemberId: z.string().min(1).optional(),
    ownerOrganizationId: z.string().min(1).optional(),
    ownerIdentity: z.string().min(1).optional(),
  })
  .strict();
export type ChannelOnboarding = z.infer<typeof ChannelOnboardingSchema>;

export type OnboardingAuthority =
  | { kind: "local-operator" }
  | {
      kind: "account";
      userId: string;
      membershipId: string;
      isInstanceOperator: boolean;
      source: "browser" | "apiKey" | "cliCredential";
    };

export interface OnboardingServices {
  /** Absent only behind the pre-existing OS-local operator gate. Never infer it from HTTP origin. */
  authority?: OnboardingAuthority;
  readBot?: (daemonId: string, botId: string) => Promise<BotPayload | undefined>;
  runtime: DatabaseRuntime;
  access: AccessStore;
  providerApplications?: import("../../provider-applications/index.js").ProviderApplications;
}

export async function onboardingOwner(
  services: OnboardingServices,
  organizationId: string,
  email?: string,
  memberId?: string,
) {
  const result = await services.runtime.query<{ id: string; user_id: string; email: string }>(
    `select m.id, m.user_id, u.email from member m join "user" u on u.id = m.user_id
     where m.organization_id = $1 and (($3::text is not null and m.id = $3)
       or ($3::text is null and m.role = 'owner' and ($2::text is null or lower(u.email) = lower($2))))`,
    [organizationId, email ?? null, memberId ?? null],
  );
  if (result.rows.length !== 1) {
    throw conflict(
      "Select the existing organization owner with --owner-email; finish Account setup if no owner exists.",
    );
  }
  const owner = result.rows[0]!;
  if (email && owner.email.toLowerCase() !== email.toLowerCase())
    throw conflict("The supplied Owner email and Member do not match.");
  return owner;
}

export async function prepareChannelOnboarding(
  database: Database,
  services: OnboardingServices,
  email?: string,
  organizationId?: string,
) {
  const organizations = (await database.listOrganizationsForOperator()).filter(
    (org) => !organizationId || org.id === organizationId,
  );
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
  ownerMemberId: string,
): HubBundleFile[] {
  const legacyKey = `bot-${input.name}`;
  const resource = load(
    files.find((file) => file.path === CHANNEL_RESOURCE_PATH)?.content ?? "{}",
  ) as { environments?: Record<string, { daemon?: string; projectId?: string; cwd?: string }> };
  const legacy = resource?.environments?.[legacyKey];
  // COMPAT(onboarding-resource-id): reuse an old mapping only in the same Host/home scope.
  // Its customized routes stay untouched; a display-name match on another Host never adopts it.
  const sameHome =
    legacy?.daemon === input.daemonId &&
    legacy.projectId === input.projectId &&
    legacy.cwd === input.cwd;
  const authoritativeKey = input.botId ? `bot-${input.botId}` : legacyKey;
  const key = sameHome ? legacyKey : authoritativeKey;
  const resourceFile = configureOnboardingResources(files, key, input);
  const accountPath = `${CHANNELS_DIRECTORY}/${channel}/${accountId}.yml`;
  const account = AccountFileSchema.parse(
    load(files.find(({ path }) => path === accountPath)!.content),
  );
  const retained = (account.routes ?? []).filter(
    (route) => route.agent !== key || route.environment !== key,
  );
  // One Route per Where: this Bot owner in DMs answers without a mention; in
  // every group chat (threads and topics belong to their room) need one.
  const wheres = [{ dm: true }, { groups: "all" as const }];
  if (retained.length === (account.routes ?? []).length)
    account.routes = [
      ...retained,
      ...wheres.map((where) => ({
        audience: [
          {
            who: { members: [ownerMemberId] },
            where,
            interaction: { requireMention: where.dm !== true },
          },
        ],
        agent: key,
        environment: key,
        reply: channel === "slack" && where.dm !== true ? { anchor: "thread" as const } : undefined,
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
  const resourceFile = files.find(({ path }) => path === CHANNEL_RESOURCE_PATH);
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
    path: CHANNEL_RESOURCE_PATH,
    content: dump({ ...resource, environments, agents }, { lineWidth: -1 }),
  };
}

export async function linkOnboardingOwner(
  services: OnboardingServices,
  organizationId: string,
  connectionId: string,
  input: ChannelOnboarding,
): Promise<{ ready: boolean; command?: string; expiresAt?: string; guidance?: string }> {
  const owner = await onboardingOwner(
    services,
    organizationId,
    input.ownerEmail,
    input.ownerMemberId,
  );
  const realm = await services.access.channelIdentityRealm(organizationId, connectionId);
  const identities = (await services.access.listChannelIdentities(organizationId)).filter(
    (identity) => identity.identityRealm === realm,
  );
  if (
    input.ownerIdentity &&
    identities.some(
      (identity) =>
        identity.externalSubjectId === input.ownerIdentity && identity.memberId !== owner.id,
    )
  ) {
    throw conflict(
      "This channel identity already belongs to another Member. Update verified identities in Hub before assigning it to this owner.",
    );
  }
  const verifiedOwner = identities.filter((identity) => identity.memberId === owner.id);
  if (
    input.ownerIdentity &&
    verifiedOwner.length &&
    !verifiedOwner.some((identity) => identity.externalSubjectId === input.ownerIdentity)
  )
    throw conflict(
      "The owner already has a verified channel identity. Replace it explicitly in Hub identity administration; retry does not replace the owner.",
    );
  if (input.ownerIdentity) {
    requireDirectIdentityAuthority(services);
    await services.access.bindChannelIdentity({
      organizationId,
      memberId: owner.id,
      connectionId,
      externalSubjectId: input.ownerIdentity,
      displayName: null,
      verificationMethod: "administrator",
      verifiedByUserId: services.authority?.kind === "account" ? services.authority.userId : null,
    });
  }
  if (input.ownerIdentity || identities.some((identity) => identity.memberId === owner.id)) {
    return { ready: true };
  }
  if (services.authority?.kind === "account" && services.authority.userId !== owner.user_id)
    return {
      ready: false,
      guidance:
        "The Bot Owner must sign in to this Hub with their own account and verify their Channel identity using Settings → Channel identities. Ask them to redeem their own /link command in DM (or a group); this configuration has not issued their invitation to you.",
    };
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
  input: { botToken: string; appToken: string; ownerEmail?: string; ownerMemberId?: string },
): Promise<string> {
  const configure = services.providerApplications?.configureLocalSlackSocket;
  if (!configure) throw conflict("Slack setup is unavailable on this Hub");
  const owner = await onboardingOwner(
    services,
    organizationId,
    input.ownerEmail,
    input.ownerMemberId,
  );
  const userId = services.authority?.kind === "account" ? services.authority.userId : owner.user_id;
  const result = await configure(request, { userId, organizationId }, input);
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
): Promise<ChannelOnboarding> {
  if (!services) throw conflict("Local onboarding services are unavailable");
  if (input.ownerOrganizationId && input.ownerOrganizationId !== organizationId)
    throw conflict(
      "This Bot owner belongs to a different Hub organization. Select the Bot's own Hub before linking.",
    );
  if (input.ownerIdentity) requireDirectIdentityAuthority(services);
  const daemon = await database.findDaemonForOrganization(organizationId, input.daemonId);
  if (!daemon || daemon.status !== "active")
    throw invalidRequest("The onboarding daemon is not enrolled in this organization");
  if (services.authority?.kind === "account")
    return validateRemoteBotOwner(services, organizationId, input);
  await onboardingOwner(services, organizationId, input.ownerEmail, input.ownerMemberId);
  return input;
}

function requireDirectIdentityAuthority(services: OnboardingServices): void {
  const authority = services.authority;
  if (
    authority?.kind === "account" &&
    !(authority.source === "browser" && authority.isInstanceOperator)
  )
    throw new ProductRequestError(403, "channel_identity_verification_required");
}

async function validateRemoteBotOwner(
  services: OnboardingServices,
  organizationId: string,
  input: ChannelOnboarding,
): Promise<ChannelOnboarding> {
  if (!input.botId || !services.readBot)
    throw conflict(
      "The Bot Owner cannot be verified. Connect the Bot's Host and retry, or configure it through the authorized local CLI.",
    );
  const bot = await services.readBot(input.daemonId, input.botId);
  if (!bot || bot.archivedAt || bot.projectId !== input.projectId || bot.cwd !== input.cwd)
    throw conflict("The Bot does not match this enrolled Host, Project and folder.");
  if (
    bot.owner.kind !== "user" ||
    !bot.owner.memberId ||
    bot.owner.organizationId !== organizationId
  )
    throw conflict(
      "This Bot has no verified Owner membership in this Hub. Its local Owner must complete authorized local onboarding; the configuring Admin is not substituted.",
    );
  const owner = await onboardingOwner(services, organizationId, undefined, bot.owner.memberId);
  if (
    owner.user_id !== bot.owner.id ||
    (input.ownerMemberId && input.ownerMemberId !== owner.id) ||
    (input.ownerEmail && input.ownerEmail.toLowerCase() !== owner.email.toLowerCase())
  )
    throw conflict("The supplied Owner does not match the Bot's authoritative Owner membership.");
  return {
    ...input,
    ownerMemberId: owner.id,
    ownerOrganizationId: organizationId,
    ownerEmail: owner.email,
  };
}
