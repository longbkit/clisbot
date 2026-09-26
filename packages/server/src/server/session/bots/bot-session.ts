import type pino from "pino";
import type { StoredBot } from "@getpaseo/protocol/bots/types";
import type { SessionActor } from "@getpaseo/protocol/session-authorship";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { BotRequestError } from "../../bots/bot-creation.js";
import type { BotService } from "../../bots/index.js";
import type { ProjectPrivilege } from "../../managed-access/types.js";

/**
 * The `bot.*` RPC handlers of one session (docs/features/bots-and-chats/README.md).
 * `session.ts` constructs one when the daemon has a Bot service and routes the five
 * request types here; with the flag off `dispatchBotMessage` answers `bots_disabled`.
 */
type BotRequest = Extract<
  SessionInboundMessage,
  {
    type:
      | "bot.create.request"
      | "bot.list.request"
      | "bot.update.request"
      | "bot.archive.request"
      | "bot.template.seed.request";
  }
>;
type BotRequestOf<T extends BotRequest["type"]> = Extract<BotRequest, { type: T }>;

/** The slice of `ManagedResourceAuthorizer` a bot request needs. */
export interface BotSessionAuthority {
  isRestricted(): boolean;
  allowsProject(projectId: string, privilege: ProjectPrivilege): boolean;
  mayCreateProjectAt(path: string): Promise<boolean>;
}

export interface BotSessionHost {
  emit(msg: SessionOutboundMessage): void;
  /** The ticket's actor; undefined for the local owner. */
  actor(): SessionActor | undefined;
  authority: BotSessionAuthority;
}

export interface BotSessionOptions {
  host: BotSessionHost;
  service: BotService;
  logger: pino.Logger;
}

/** The identity a bot records when the session has no Hub actor (`OWNER_SESSION_ADMISSION`). */
const LOCAL_OWNER: SessionActor = { kind: "user", id: "owner" };

function errorPayload(error: unknown): { error: string; errorCode?: string } {
  if (error instanceof BotRequestError) return { error: error.message, errorCode: error.code };
  return { error: error instanceof Error ? error.message : String(error) };
}

export class BotSession {
  private readonly host: BotSessionHost;
  private readonly service: BotService;
  private readonly logger: pino.Logger;
  private readonly unsubscribe: () => void;

  constructor(options: BotSessionOptions) {
    this.host = options.host;
    this.service = options.service;
    this.logger = options.logger;
    this.unsubscribe = this.service.subscribe((event) => {
      this.host.emit({ type: "bot.updated", payload: event });
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  async handleCreate(request: BotRequestOf<"bot.create.request">): Promise<void> {
    const { requestId } = request;
    try {
      const authority = this.host.authority;
      const result = await this.service.create(
        {
          name: request.name,
          kind: request.kind,
          description: request.description,
          path: request.path,
          launch: request.launch,
          template: request.template,
        },
        {
          owner: this.host.actor() ?? LOCAL_OWNER,
          mayCreateAt: authority.isRestricted()
            ? (cwd) => authority.mayCreateProjectAt(cwd)
            : undefined,
        },
      );
      this.host.emit({
        type: "bot.create.response",
        payload: {
          requestId,
          bot: result.bot,
          reused: result.reused,
          template: pickTemplateResult(result.template),
          error: null,
        },
      });
    } catch (error) {
      this.logger.error({ err: error, requestId }, "bot.create failed");
      this.host.emit({
        type: "bot.create.response",
        payload: { requestId, bot: null, ...errorPayload(error) },
      });
    }
  }

  async handleList(request: BotRequestOf<"bot.list.request">): Promise<void> {
    const { requestId } = request;
    try {
      const bots = (await this.service.list(request.includeArchived === true)).filter((bot) =>
        this.host.authority.allowsProject(bot.projectId, "project.use"),
      );
      this.host.emit({ type: "bot.list.response", payload: { requestId, bots, error: null } });
    } catch (error) {
      this.host.emit({
        type: "bot.list.response",
        payload: { requestId, bots: [], ...errorPayload(error) },
      });
    }
  }

  async handleUpdate(request: BotRequestOf<"bot.update.request">): Promise<void> {
    const { requestId, botId } = request;
    try {
      await this.requireManage(botId);
      const bot = await this.service.update(botId, {
        name: request.name,
        title: request.title,
        description: request.description,
        avatar: request.avatar,
        launch: request.launch,
      });
      this.host.emit({ type: "bot.update.response", payload: { requestId, bot, error: null } });
    } catch (error) {
      this.host.emit({
        type: "bot.update.response",
        payload: { requestId, bot: null, ...errorPayload(error) },
      });
    }
  }

  async handleArchive(request: BotRequestOf<"bot.archive.request">): Promise<void> {
    const { requestId, botId } = request;
    try {
      await this.requireManage(botId);
      const bot = await this.service.archive(botId);
      this.host.emit({
        type: "bot.archive.response",
        payload: { requestId, botId, archivedAt: bot.archivedAt, error: null },
      });
    } catch (error) {
      this.host.emit({
        type: "bot.archive.response",
        payload: { requestId, botId, archivedAt: null, ...errorPayload(error) },
      });
    }
  }

  async handleTemplateSeed(request: BotRequestOf<"bot.template.seed.request">): Promise<void> {
    const { requestId, botId } = request;
    try {
      await this.requireManage(botId);
      const result = await this.service.seedTemplate(botId, request.overwrite === true);
      this.host.emit({
        type: "bot.template.seed.response",
        payload: {
          requestId,
          bot: result.bot,
          template: pickTemplateResult(result.template),
          error: null,
        },
      });
    } catch (error) {
      this.host.emit({
        type: "bot.template.seed.response",
        payload: { requestId, bot: null, ...errorPayload(error) },
      });
    }
  }

  /** A restricted session edits a bot through `workspace.manage` on the bot's Project (D13). */
  private async requireManage(botId: string): Promise<StoredBot> {
    const bot = await this.service.get(botId);
    if (!bot || !this.host.authority.allowsProject(bot.projectId, "project.use")) {
      throw new BotRequestError("bot_not_found", `Bot ${botId} does not exist.`);
    }
    if (!this.host.authority.allowsProject(bot.projectId, "workspace.manage")) {
      throw new BotRequestError("access_denied", `Your access does not allow editing ${bot.name}.`);
    }
    return bot;
  }
}

/** One per session when the daemon has a Bot service; null keeps the flag-off path inert. */
export function createBotSession(
  service: BotService | undefined,
  host: BotSessionHost,
  logger: pino.Logger,
): BotSession | null {
  return service ? new BotSession({ host, service, logger }) : null;
}

function pickTemplateResult(template: {
  created: string[];
  skipped: string[];
  overwritten?: string[];
}): { created: string[]; skipped: string[]; overwritten?: string[] } {
  return {
    created: template.created,
    skipped: template.skipped,
    ...(template.overwritten ? { overwritten: template.overwritten } : {}),
  };
}

/**
 * Routes a `bot.*` request to the session's handler, or answers `rpc_error bots_disabled`
 * when the daemon runs with the flag off. Undefined for any other message.
 */
export function dispatchBotMessage(
  session: BotSession | null,
  msg: SessionInboundMessage,
  emit: (msg: SessionOutboundMessage) => void,
): Promise<void> | undefined {
  switch (msg.type) {
    case "bot.create.request":
      return session ? session.handleCreate(msg) : emitBotsDisabled(msg, emit);
    case "bot.list.request":
      return session ? session.handleList(msg) : emitBotsDisabled(msg, emit);
    case "bot.update.request":
      return session ? session.handleUpdate(msg) : emitBotsDisabled(msg, emit);
    case "bot.archive.request":
      return session ? session.handleArchive(msg) : emitBotsDisabled(msg, emit);
    case "bot.template.seed.request":
      return session ? session.handleTemplateSeed(msg) : emitBotsDisabled(msg, emit);
    default:
      return undefined;
  }
}

async function emitBotsDisabled(
  request: BotRequest,
  emit: (msg: SessionOutboundMessage) => void,
): Promise<void> {
  emit({
    type: "rpc_error",
    payload: {
      requestId: request.requestId,
      requestType: request.type,
      error: "Bots are not enabled on this Host (daemon.bots.enabled).",
      code: "bots_disabled",
    },
  });
}
