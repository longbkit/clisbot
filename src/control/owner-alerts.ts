import type { LoadedConfig } from "../config/load-config.ts";
import type { ChannelPlugin } from "../channels/channel-plugin.ts";
import type { ParsedMessageCommand } from "../channels/message-command.ts";

function parseOwnerPrincipal(principal: string) {
  const trimmed = principal.trim();
  if (!trimmed) {
    return null;
  }

  const [platform, userId] = trimmed.split(":", 2);
  if (
    (platform !== "slack" && platform !== "telegram") ||
    !userId?.trim()
  ) {
    return null;
  }

  return {
    platform,
    userId: userId.trim(),
  } as const;
}

function buildOwnerAlertCommand(params: {
  platform: "slack" | "telegram";
  botId: string;
  userId: string;
  message: string;
}): ParsedMessageCommand {
  return {
    action: "send",
    channel: params.platform,
    account: params.botId,
    target: params.platform === "slack" ? `user:${params.userId}` : params.userId,
    message: params.message,
    messageFile: undefined,
    media: undefined,
    messageId: undefined,
    emoji: undefined,
    remove: false,
    threadId: undefined,
    replyTo: undefined,
    limit: undefined,
    query: undefined,
    pollQuestion: undefined,
    pollOptions: [],
    forceDocument: false,
    silent: false,
    progress: false,
    final: false,
    json: false,
    inputFormat: "md",
    renderMode: "native",
  };
}

function dedupe(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export async function sendOwnerAlert(params: {
  loadedConfig: LoadedConfig;
  message: string;
  listChannelPlugins: () => ChannelPlugin[];
}) {
  const plugins = params.listChannelPlugins();
  const delivered: string[] = [];
  const failed: Array<{ principal: string; detail: string }> = [];

  for (const platform of ["slack", "telegram"] as const) {
    const principals = dedupe(params.loadedConfig.raw.app.auth.roles.owner?.users ?? []);
    const ownerIds = principals
      .map(parseOwnerPrincipal)
      .filter((entry): entry is NonNullable<typeof entry> => entry?.platform === platform)
      .map((entry) => entry.userId);

    if (ownerIds.length === 0) {
      continue;
    }

    const plugin = plugins.find((entry) => entry.id === platform);
    if (!plugin || !plugin.isEnabled(params.loadedConfig)) {
      continue;
    }

    const botIds = dedupe(
      plugin.listBots(params.loadedConfig).map((entry) => entry.botId),
    );

    for (const userId of ownerIds) {
      let deliveredToPrincipal = false;
      const principal = `${platform}:${userId}`;

      for (const botId of botIds) {
        try {
          await plugin.runMessageCommand(
            params.loadedConfig,
            buildOwnerAlertCommand({
              platform,
              botId,
              userId,
              message: params.message,
            }),
          );
          delivered.push(`${principal} via ${platform}/${botId}`);
          deliveredToPrincipal = true;
          break;
        } catch (error) {
          failed.push({
            principal,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (!deliveredToPrincipal && botIds.length === 0) {
        failed.push({
          principal,
          detail: "no enabled bots were available for this platform",
        });
      }
    }
  }

  return {
    delivered,
    failed,
  };
}
