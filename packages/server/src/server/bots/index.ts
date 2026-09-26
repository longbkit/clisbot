import { join } from "node:path";
import type { Logger } from "pino";
import type { BotLaunchDefaults, StoredBot } from "@getpaseo/protocol/bots/types";
import type { ProjectRegistry, WorkspaceRegistry } from "../workspace-registry.js";
import {
  BotRequestError,
  createBot,
  type BotCreateContext,
  type BotCreateInput,
  type BotCreateResult,
  type BotProvisioningDeps,
} from "./bot-creation.js";
import { BotStore, type BotChangeEvent } from "./bot-store.js";
import type { BotsConfig } from "./bots-config.js";
import {
  botTemplateId,
  seedBotTemplate,
  type BotTemplateSeedResult,
} from "./bot-template-seeding.js";

/**
 * The daemon-wide Bot service `bootstrap.ts` builds when `daemon.bots.enabled` is on
 * (docs/features/bots-and-chats/README.md). Sessions call it through `BotSession`;
 * authorization stays in the session, the service owns storage and provisioning.
 */
export interface BotServiceDeps {
  paseoHome: string;
  root: string;
  logger: Logger;
  projectRegistry: ProjectRegistry;
  workspaceRegistry: WorkspaceRegistry;
  findOrCreateProjectForDirectory: BotProvisioningDeps["findOrCreateProjectForDirectory"];
  createWorkspaceForDirectory: BotProvisioningDeps["createWorkspaceForDirectory"];
  emitWorkspaceUpdates: BotProvisioningDeps["emitWorkspaceUpdates"];
  /** Archives the bot's Workspace the way `archive_workspace_request` does; the directory stays. */
  archiveWorkspace(workspaceId: string): Promise<void>;
  isProviderAvailable(provider: string): boolean;
}

export interface BotUpdatePatch {
  name?: string;
  title?: string | null;
  description?: string | null;
  avatar?: string | null;
  launch?: BotLaunchDefaults;
}

export interface BotService {
  readonly root: string;
  list(includeArchived?: boolean): Promise<StoredBot[]>;
  get(botId: string): Promise<StoredBot | null>;
  create(input: BotCreateInput, context: BotCreateContext): Promise<BotCreateResult>;
  update(botId: string, patch: BotUpdatePatch): Promise<StoredBot>;
  archive(botId: string): Promise<StoredBot>;
  seedTemplate(
    botId: string,
    overwrite: boolean,
  ): Promise<{ bot: StoredBot; template: BotTemplateSeedResult }>;
  subscribe(listener: (event: BotChangeEvent) => void): () => void;
}

/** Null with the flag off, so the daemon stays upstream-equivalent (D10). */
export function createBotServiceFromConfig(
  bots: BotsConfig | undefined,
  deps: Omit<BotServiceDeps, "root">,
): BotService | null {
  return bots?.enabled ? createBotService({ ...deps, root: bots.root }) : null;
}

export function createBotService(deps: BotServiceDeps): BotService {
  const store = new BotStore(join(deps.paseoHome, "bots"), deps.logger.child({ module: "bots" }));
  const provisioning: BotProvisioningDeps = { ...deps, store };
  // Slug allocation, the directory and the record are decided under one queue so two
  // `bot.create` calls cannot pick the same home.
  let creations: Promise<unknown> = Promise.resolve();

  async function requireActive(botId: string): Promise<StoredBot> {
    const bot = await store.get(botId);
    if (!bot) throw new BotRequestError("bot_not_found", `Bot ${botId} does not exist.`);
    if (bot.archivedAt !== null) {
      throw new BotRequestError("bot_archived", `Bot ${botId} is archived.`);
    }
    return bot;
  }

  return {
    root: deps.root,
    list: async (includeArchived = false) =>
      (await store.list()).filter((bot) => includeArchived || bot.archivedAt === null),
    get: (botId) => store.get(botId),
    create(input, context) {
      const next = creations
        .catch(() => undefined)
        .then(() => createBot(provisioning, input, context));
      creations = next;
      return next;
    },
    async update(botId, patch) {
      const bot = await requireActive(botId);
      const name = patch.name?.trim();
      if (patch.name !== undefined && !name) {
        throw new BotRequestError("invalid_request", "A bot needs a name.");
      }
      const updated = await store.update(bot.id, (current) => ({
        ...current,
        ...(name ? { name } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
        ...(patch.launch !== undefined ? { launch: patch.launch } : {}),
        updatedAt: new Date().toISOString(),
      }));
      if (!updated) throw new BotRequestError("bot_not_found", `Bot ${botId} does not exist.`);
      if (name && name !== bot.name) {
        await deps.projectRegistry.update(bot.projectId, (record) => ({
          ...record,
          customName: name,
        }));
      }
      return updated;
    },
    async archive(botId) {
      const bot = await store.get(botId);
      if (!bot) throw new BotRequestError("bot_not_found", `Bot ${botId} does not exist.`);
      if (bot.archivedAt !== null) return bot;
      await deps.archiveWorkspace(bot.workspaceId);
      const now = new Date().toISOString();
      const archived = await store.update(bot.id, (current) => ({
        ...current,
        archivedAt: now,
        updatedAt: now,
      }));
      return archived ?? bot;
    },
    async seedTemplate(botId, overwrite) {
      const bot = await requireActive(botId);
      const template = await seedBotTemplate(bot.cwd, bot.kind, overwrite, bot.launch.provider);
      const now = new Date().toISOString();
      const seeded = await store.update(bot.id, (current) => ({
        ...current,
        template: { id: current.template?.id ?? botTemplateId(current.kind), seededAt: now },
        updatedAt: now,
      }));
      return { bot: seeded ?? bot, template };
    },
    subscribe: (listener) => store.subscribe(listener),
  };
}
