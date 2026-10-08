import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";

/**
 * Managed Access rules for `bot.*` traffic (docs/features/bots-and-chats/README.md, D13).
 * A bot is reached through its Project: `bot.create` needs the Host-level
 * `workspace.manage` grant like Add project, everything else is decided per bot by
 * `BotSession` against `allowsProject(bot.projectId, …)`, and replies are filtered here
 * so a record for an ungranted Project never leaves the daemon.
 */
export interface BotInboundAuthority {
  allowsDaemonPrivilege(privilege: "workspace.manage"): boolean;
}

/**
 * Whether a restricted session may send a `bot.*` request, or undefined for other
 * messages. An admitted `bot.create` is recorded so its reply passes the outbound
 * filter before the new Project is in the session's ticket.
 */
export function allowsBotInbound(
  message: SessionInboundMessage,
  authority: BotInboundAuthority,
  admittedProjectCreations: Set<string>,
): boolean | undefined {
  switch (message.type) {
    case "bot.create.request": {
      const allowed = authority.allowsDaemonPrivilege("workspace.manage");
      if (allowed) admittedProjectCreations.add(message.requestId);
      return allowed;
    }
    // Reads which file names exist in a folder, so it asks what creating a bot there would.
    case "bot.template.preview.request":
      return authority.allowsDaemonPrivilege("workspace.manage");
    case "bot.list.request":
    case "bot.update.request":
    case "bot.archive.request":
    case "bot.template.seed.request":
      // The request names a bot, not a Project; the handler resolves the bot and
      // checks `workspace.manage` (or `project.use` for the list) on its Project.
      return true;
    default:
      return undefined;
  }
}

/** Whether a `bot.*` reply or push may reach a restricted session, or undefined for other messages. */
export function allowsBotOutbound(
  message: SessionOutboundMessage,
  allowsProject: (projectId: string) => boolean,
): boolean | undefined {
  switch (message.type) {
    case "bot.list.response":
      return message.payload.bots.every((bot) => allowsProject(bot.projectId));
    case "bot.updated":
      return message.payload.kind === "upsert"
        ? allowsProject(message.payload.bot.projectId)
        : true;
    case "bot.create.response":
    case "bot.update.response":
    case "bot.template.seed.response":
      return message.payload.bot === null || allowsProject(message.payload.bot.projectId);
    case "bot.archive.response":
    case "bot.template.preview.response":
      // Carries only the id the requester sent, or file names the request was admitted for.
      return true;
    default:
      return undefined;
  }
}
