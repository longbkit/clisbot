import { createBotStartDeps } from "./run.js";
import { listDaemonBots, hydrateBotReference } from "./daemon-bot.js";
import { readBotManifests, type BotManifest } from "./manifest.js";

/** Read authoritative Bots; local manifests contribute only channel restart metadata. */
export async function readBotCatalog(home: string) {
  const deps = createBotStartDeps(home, process.env);
  const client = await deps.openDaemon(
    await deps.daemonHost(home, process.env),
    deps.daemonPassword(home),
  );
  try {
    const bots = await listDaemonBots(client);
    const references = await readBotManifests(home);
    return bots.map((bot) => {
      const reference = references.find(
        (ref) => ref.botId === bot.id || (ref.version === 1 && ref.workspacePath === bot.cwd),
      );
      const projection: BotManifest = reference ?? {
        version: 2,
        botId: bot.id,
        name: bot.name,
        botType: bot.kind,
        provider: bot.launch.provider,
        workspacePath: bot.cwd,
        workspaceId: bot.workspaceId,
        agentId: "",
        agentTitle: bot.name,
        channel: "telegram",
        account: "",
        credentials: {},
        createdAt: bot.createdAt,
        updatedAt: bot.updatedAt,
      };
      return {
        manifest: hydrateBotReference({ ...projection, name: bot.name }, bot),
        hasChannel: Boolean(reference),
      };
    });
  } finally {
    await deps.closeDaemon(client);
  }
}
