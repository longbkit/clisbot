import { lstat, mkdir, rm } from "node:fs/promises";
import type { Logger } from "pino";
import type {
  BotErrorCode,
  BotKind,
  BotLaunchDefaults,
  StoredBot,
} from "@getpaseo/protocol/bots/types";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import type {
  PersistedProjectRecord,
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "../workspace-registry.js";
import { assertBotHomeAllowed, BotHomeError, resolveBotHome, type BotHome } from "./bot-home.js";
import { botSlug } from "./bot-slug.js";
import type { BotStore } from "./bot-store.js";
import {
  botTemplateId,
  seedBotTemplate,
  type BotTemplateSeedResult,
} from "./bot-template-seeding.js";

/**
 * `bot.create` on the daemon (docs/features/bots-and-chats/plans/server-bot.md, §3):
 * validate, resolve the home, refuse the OS home root and nested Projects, provision the
 * directory + Project + Workspace, seed the persona files, name the Project after the bot,
 * then write the record. Anything made by this call is removed when a later step fails.
 */
export class BotRequestError extends Error {
  constructor(
    readonly code: BotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BotRequestError";
  }
}

export interface BotCreateInput {
  name: string;
  kind?: BotKind;
  description?: string;
  path?: string;
  launch: BotLaunchDefaults;
  template?: { overwrite?: boolean };
}

export interface BotCreateContext {
  owner: SessionActor;
  /** A restricted session's Project-creation rule for the resolved home; absent for the owner. */
  mayCreateAt?: (cwd: string) => Promise<boolean>;
}

export interface BotCreateResult {
  bot: StoredBot;
  reused: boolean;
  template: BotTemplateSeedResult;
}

export interface BotProvisioningDeps {
  root: string;
  logger: Logger;
  store: BotStore;
  projectRegistry: ProjectRegistry;
  workspaceRegistry: WorkspaceRegistry;
  findOrCreateProjectForDirectory(cwd: string): Promise<PersistedProjectRecord>;
  createWorkspaceForDirectory(
    cwd: string,
    title: string,
    projectId: string,
  ): Promise<PersistedWorkspaceRecord>;
  emitWorkspaceUpdates(workspaceIds: string[]): Promise<void>;
  isProviderAvailable(provider: string): boolean;
}

export async function createBot(
  deps: BotProvisioningDeps,
  input: BotCreateInput,
  context: BotCreateContext,
): Promise<BotCreateResult> {
  const name = validateCreateInput(deps, input);
  const kind = input.kind ?? "personal";
  const overwrite = input.template?.overwrite === true;
  const bots = await deps.store.list();
  const home = await resolveBotHome({
    name,
    path: input.path,
    root: deps.root,
    takenSlugs: new Set(bots.map((bot) => bot.slug)),
  });
  const existing = findReusableBot(bots, home, name);
  if (existing) {
    const template = await seedBotTemplate(
      existing.cwd,
      existing.kind,
      overwrite,
      existing.launch.provider,
    );
    return { bot: await markSeeded(deps.store, existing.id), reused: true, template };
  }
  await assertHomeAllowed(deps, home.cwd, context);
  return provisionBot(deps, { name, kind, overwrite, home, input, owner: context.owner });
}

function validateCreateInput(deps: BotProvisioningDeps, input: BotCreateInput): string {
  const name = input.name.trim();
  if (!name) throw new BotRequestError("invalid_request", "A bot needs a name.");
  const provider = input.launch.provider.trim();
  if (!provider || !deps.isProviderAvailable(provider)) {
    throw new BotRequestError(
      "provider_unavailable",
      `Provider "${provider}" is not configured and enabled on this Host.`,
    );
  }
  return name;
}

/** An explicit path names a bot by its home; a name names it by slug. Archived bots are not reused. */
function findReusableBot(bots: StoredBot[], home: BotHome, name: string): StoredBot | null {
  const match = home.explicit
    ? bots.find((bot) => bot.cwd === home.cwd)
    : bots.find((bot) => bot.slug === botSlug(name) && bot.archivedAt === null);
  if (!match) return null;
  if (match.archivedAt !== null) {
    throw new BotRequestError("bot_archived", `The bot at ${match.cwd} is archived.`);
  }
  return match;
}

async function assertHomeAllowed(
  deps: BotProvisioningDeps,
  cwd: string,
  context: BotCreateContext,
): Promise<void> {
  const projectRoots = (await deps.projectRegistry.list())
    .filter((project) => project.archivedAt === null)
    .map((project) => project.rootPath);
  try {
    await assertBotHomeAllowed(cwd, projectRoots);
  } catch (error) {
    if (error instanceof BotHomeError) throw new BotRequestError(error.code, error.message);
    throw error;
  }
  if (context.mayCreateAt && !(await context.mayCreateAt(cwd))) {
    throw new BotRequestError(
      "access_denied",
      `Your access does not allow creating a Project at ${cwd}.`,
    );
  }
}

interface ProvisionInput {
  name: string;
  kind: BotKind;
  overwrite: boolean;
  home: BotHome;
  input: BotCreateInput;
  owner: SessionActor;
}

async function provisionBot(
  deps: BotProvisioningDeps,
  plan: ProvisionInput,
): Promise<BotCreateResult> {
  const { cwd } = plan.home;
  const made = {
    directory: false,
    project: null as string | null,
    workspace: null as string | null,
  };
  try {
    made.directory = await ensureDirectory(cwd);
    const projectExisted = await hasActiveProjectAt(deps.projectRegistry, cwd);
    const project = await deps.findOrCreateProjectForDirectory(cwd);
    if (!projectExisted) made.project = project.projectId;
    const workspace = await deps.createWorkspaceForDirectory(cwd, plan.name, project.projectId);
    made.workspace = workspace.workspaceId;
    const template = await seedBotTemplate(
      cwd,
      plan.kind,
      plan.overwrite,
      plan.input.launch.provider,
    );
    // The Hub Access picker shows `customName ?? displayName`; without this a shared bot is its slug.
    await deps.projectRegistry.update(project.projectId, (record) => ({
      ...record,
      customName: plan.name,
    }));
    const bot = await deps.store.create(
      newBotRecord(plan, project.projectId, workspace.workspaceId),
    );
    await deps.emitWorkspaceUpdates([workspace.workspaceId]);
    return { bot, reused: false, template };
  } catch (error) {
    await rollbackProvisioning(deps, cwd, made);
    throw error;
  }
}

function newBotRecord(
  plan: ProvisionInput,
  projectId: string,
  workspaceId: string,
): Omit<StoredBot, "id"> {
  const now = new Date().toISOString();
  return {
    slug: plan.home.slug,
    name: plan.name,
    description: plan.input.description ?? null,
    kind: plan.kind,
    projectId,
    workspaceId,
    cwd: plan.home.cwd,
    launch: plan.input.launch,
    template: { id: botTemplateId(plan.kind), seededAt: now },
    owner: plan.owner,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

async function markSeeded(store: BotStore, botId: string): Promise<StoredBot> {
  const now = new Date().toISOString();
  const updated = await store.update(botId, (bot) => ({
    ...bot,
    template: { id: bot.template?.id ?? botTemplateId(bot.kind), seededAt: now },
    updatedAt: now,
  }));
  if (!updated) throw new BotRequestError("bot_not_found", `Bot ${botId} disappeared.`);
  return updated;
}

/** True when this call made the directory. */
async function ensureDirectory(cwd: string): Promise<boolean> {
  try {
    await lstat(cwd);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(cwd, { recursive: true });
  return true;
}

async function hasActiveProjectAt(registry: ProjectRegistry, cwd: string): Promise<boolean> {
  return (await registry.list()).some(
    (project) => project.archivedAt === null && project.rootPath === cwd,
  );
}

async function rollbackProvisioning(
  deps: BotProvisioningDeps,
  cwd: string,
  made: { directory: boolean; project: string | null; workspace: string | null },
): Promise<void> {
  try {
    if (made.workspace) await deps.workspaceRegistry.remove(made.workspace);
    if (made.project) await deps.projectRegistry.remove(made.project);
    if (made.directory) await rm(cwd, { recursive: true, force: true });
  } catch (error) {
    deps.logger.error({ err: error, cwd }, "Failed to roll back a bot that did not get created");
  }
}
