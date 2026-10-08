import { lstat, mkdir, rm } from "node:fs/promises";
import type { Logger } from "pino";
import type {
  BotErrorCode,
  BotKind,
  BotLaunchDefaults,
  StoredBot,
} from "@clisbot/protocol/bots/types";
import type { SessionActor } from "@clisbot/protocol/session-authorship";
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
  previewBotTemplate,
  restoreReplacedFiles,
  seedBotTemplate,
  type BotTemplateOverwrite,
  type BotTemplatePreviewFile,
  type BotTemplateSeedResult,
} from "./bot-template-seeding.js";
import { areEquivalentPaths } from "../../utils/path.js";

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
  template?: { seed?: boolean; overwrite?: BotTemplateOverwrite };
}

export interface BotCreateContext {
  owner: SessionActor;
  /** A restricted session's Project-creation rule for the resolved home; absent for the owner. */
  mayCreateAt?: (cwd: string) => Promise<boolean>;
  /** Reusing a home can seed files, so it requires management of that Project. */
  mayReuse?: (bot: StoredBot) => boolean;
  /** A home at an existing Project's root shares that Project; it needs managing it. */
  mayShareProject?: (projectId: string) => boolean;
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
  const overwrite = input.template?.overwrite ?? false;
  const bots = await deps.store.list();
  const home = await resolveBotHome({
    name,
    path: input.path,
    root: deps.root,
    takenSlugs: new Set(bots.map((bot) => bot.slug)),
  });
  const existing = findReusableBot(bots, home, name);
  if (existing) {
    if (context.mayReuse && !context.mayReuse(existing)) {
      throw new BotRequestError("access_denied", "Your access does not allow reusing this bot.");
    }
    if (input.template?.seed === false) {
      return {
        bot: existing,
        reused: true,
        template: { directory: existing.cwd, created: [], skipped: [] },
      };
    }
    const template = await seedBotTemplate(
      existing.cwd,
      existing.kind,
      overwrite,
      existing.launch.provider,
    );
    return { bot: await markSeeded(deps.store, existing.id), reused: true, template };
  }
  const sharedProjectId = await assertHomeAllowed(deps, home.cwd, context);
  return provisionBot(deps, {
    name,
    kind,
    overwrite,
    seed: input.template?.seed !== false,
    sharedProjectId,
    home,
    input,
    owner: context.owner,
  });
}

/**
 * What a template would write into the home `bot.create` would use for `path`, after the same
 * checks: a folder the caller could not make a bot in is not one it may look into either.
 */
export async function previewTemplateAt(
  deps: BotProvisioningDeps,
  input: { path: string; kind: BotKind; provider?: string },
  context: Omit<BotCreateContext, "owner" | "mayReuse">,
): Promise<BotTemplatePreviewFile[]> {
  const home = await resolveBotHome({
    name: "preview",
    path: input.path,
    root: deps.root,
    takenSlugs: new Set(),
  }).catch((error: unknown) => {
    if (error instanceof BotHomeError) throw new BotRequestError(error.code, error.message);
    throw error;
  });
  await assertHomeAllowed(deps, home.cwd, context);
  return previewBotTemplate(home.cwd, input.kind, input.provider);
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

/**
 * An explicit path names a bot by its home; a name names it by slug. Archived bots are not
 * reused: a folder whose bot was archived can have a new one.
 */
function findReusableBot(bots: StoredBot[], home: BotHome, name: string): StoredBot | null {
  const active = bots.filter((bot) => bot.archivedAt === null);
  const match = home.explicit
    ? active.find((bot) => areEquivalentPaths(bot.cwd, home.cwd))
    : active.find((bot) => bot.slug === botSlug(name));
  return match ?? null;
}

/** Refuses a home the caller may not use; returns the existing Project at it, if any. */
async function assertHomeAllowed(
  deps: BotProvisioningDeps,
  cwd: string,
  context: Pick<BotCreateContext, "mayCreateAt" | "mayShareProject">,
): Promise<string | null> {
  const projects = (await deps.projectRegistry.list()).filter(
    (project) => project.archivedAt === null,
  );
  try {
    await assertBotHomeAllowed(
      cwd,
      projects.map((project) => project.rootPath),
    );
  } catch (error) {
    if (error instanceof BotHomeError) throw new BotRequestError(error.code, error.message);
    throw error;
  }
  const shared =
    projects.find((project) => areEquivalentPaths(project.rootPath, cwd))?.projectId ?? null;
  if (shared) {
    if (context.mayShareProject && !context.mayShareProject(shared)) {
      throw new BotRequestError(
        "access_denied",
        "Your access does not allow managing this Project.",
      );
    }
    return shared;
  }
  if (context.mayCreateAt && !(await context.mayCreateAt(cwd))) {
    throw new BotRequestError(
      "access_denied",
      `Your access does not allow creating a Project at ${cwd}.`,
    );
  }
  return null;
}

interface ProvisionInput {
  name: string;
  kind: BotKind;
  overwrite: BotTemplateOverwrite;
  /** False writes no template files; the bot starts from what the folder already holds. */
  seed: boolean;
  /** The existing Project at the home, shared: it keeps its name and listing, and is never removed. */
  sharedProjectId: string | null;
  home: BotHome;
  input: BotCreateInput;
  owner: SessionActor;
}

async function provisionBot(
  deps: BotProvisioningDeps,
  plan: ProvisionInput,
): Promise<BotCreateResult> {
  const { cwd } = plan.home;
  const made: Provisioned = { directory: false, project: null, workspace: null, template: null };
  try {
    made.directory = await ensureDirectory(cwd);
    const projectExisted =
      plan.sharedProjectId !== null || (await hasActiveProjectAt(deps.projectRegistry, cwd));
    const project = await deps.findOrCreateProjectForDirectory(cwd);
    // Never record a Project that was already there: a rollback removes what it records.
    if (!projectExisted) made.project = project.projectId;
    const workspace = await deps.createWorkspaceForDirectory(cwd, plan.name, project.projectId);
    made.workspace = workspace.workspaceId;
    const template = plan.seed
      ? await seedBotTemplate(cwd, plan.kind, plan.overwrite, plan.input.launch.provider)
      : { directory: cwd, created: [], skipped: [] };
    made.template = template;
    // The Hub Access picker shows `customName ?? displayName`; without this a shared bot is its
    // slug. A Project the bot was made from keeps the name it had.
    if (plan.sharedProjectId === null) {
      await deps.projectRegistry.update(project.projectId, (record) => ({
        ...record,
        customName: plan.name,
      }));
    }
    const bot = await deps.store.create(
      newBotRecord(plan, project.projectId, workspace.workspaceId),
    );
    // The bot record is the commit point. A notification failure must not remove its home.
    await deps.emitWorkspaceUpdates([workspace.workspaceId]).catch((error: unknown) => {
      deps.logger.warn({ err: error, botId: bot.id }, "Failed to publish the created workspace");
    });
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
    ...(plan.sharedProjectId !== null ? { sharesProject: true } : {}),
    launch: plan.input.launch,
    template: plan.seed ? { id: botTemplateId(plan.kind), seededAt: now } : null,
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
    (project) => project.archivedAt === null && areEquivalentPaths(project.rootPath, cwd),
  );
}

/** What a creation made so far, so a failure can take back exactly that. */
interface Provisioned {
  directory: boolean;
  project: string | null;
  workspace: string | null;
  template: BotTemplateSeedResult | null;
}

async function rollbackProvisioning(
  deps: BotProvisioningDeps,
  cwd: string,
  made: Provisioned,
): Promise<void> {
  try {
    // A file the template replaced goes back before anything else is undone.
    if (made.template && !made.directory) await restoreReplacedFiles(made.template);
    if (made.workspace) await deps.workspaceRegistry.remove(made.workspace);
    if (made.project) await deps.projectRegistry.remove(made.project);
    if (made.directory) await rm(cwd, { recursive: true, force: true });
  } catch (error) {
    deps.logger.error({ err: error, cwd }, "Failed to roll back a bot that did not get created");
  }
}
