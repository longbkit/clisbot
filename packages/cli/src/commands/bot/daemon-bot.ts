import type { DaemonClient } from "@clisbot/client/internal/daemon-client";
import { BotTemplateResultSchema } from "@clisbot/protocol/bots/rpc-schemas";
import type { BotPayload } from "@clisbot/protocol/bots/types";
import type { BotManifest } from "./manifest.js";
import type { AssistantPlan } from "./plan.js";

export function assertBotsEnabled(client: DaemonClient): void {
  // COMPAT(clisbot-bots-feature-gate): never seed on the CLI machine as fallback.
  if (client.getLastServerInfoMessage()?.features?.bots !== true) {
    throw new Error(
      "This Host does not support Bots. Update the Host or enable daemon.bots.enabled, then reconnect.",
    );
  }
}

export async function listDaemonBots(client: DaemonClient): Promise<BotPayload[]> {
  assertBotsEnabled(client);
  const result = await client.listBots();
  if (result.error) throw new Error(result.error);
  return result.bots;
}

export function hydrateBotReference(reference: BotManifest, bot: BotPayload): BotManifest {
  return {
    ...reference,
    botId: bot.id,
    botType: bot.kind,
    provider: bot.launch.provider,
    model: bot.launch.model,
    mode: bot.launch.modeId,
    workspacePath: bot.cwd,
    workspaceId: bot.workspaceId,
    projectId: bot.projectId,
    agentId: "",
    agentTitle: bot.name,
  };
}

export async function provisionDaemonBot(
  client: DaemonClient,
  plan: AssistantPlan,
  botId?: string,
) {
  assertBotsEnabled(client);
  const existing = await resolveExistingBot(client, plan, botId);
  const launch = {
    provider: plan.provider,
    ...(plan.model ? { model: plan.model } : {}),
    ...(plan.mode ? { modeId: plan.mode } : {}),
  };
  const result = existing
    ? await client.updateBot({ botId: existing.id, launch })
    : await client.createBot({
        name: plan.name,
        kind: plan.botType,
        ...(plan.workspacePath ? { path: plan.workspacePath } : {}),
        launch,
        template: { overwrite: plan.overwriteTemplate },
      });
  if (result.error || !result.bot) throw new Error(result.error ?? "Bot creation failed");
  if ("reused" in result && result.reused) {
    const updated = await client.updateBot({ botId: result.bot.id, launch });
    if (updated.error || !updated.bot) throw new Error(updated.error ?? "Bot update failed");
    result.bot = updated.bot;
  }
  const bot = result.bot;
  const seed = existing
    ? await client.seedBotTemplate({ botId: bot.id, overwrite: plan.overwriteTemplate })
    : result;
  if (seed.error) throw new Error(seed.error);
  const parsedTemplate = BotTemplateResultSchema.safeParse(
    "template" in seed ? seed.template : undefined,
  );
  const template = parsedTemplate.success ? parsedTemplate.data : undefined;
  return {
    botId: bot.id,
    agentId: "",
    agentTitle: bot.name,
    workspacePath: bot.cwd,
    workspaceId: bot.workspaceId,
    projectId: bot.projectId,
    ...(template ? { template: { ...template, directory: bot.cwd } } : {}),
  };
}

async function resolveExistingBot(client: DaemonClient, plan: AssistantPlan, botId?: string) {
  const existing = botId
    ? (await listDaemonBots(client)).find((bot) => bot.id === botId)
    : undefined;
  if (botId && !existing)
    throw new Error("The bot is missing or archived. Restore it before restarting.");
  if (existing && plan.workspacePath && plan.workspacePath !== existing.cwd)
    throw new Error("A Bot's home cannot move. Create a new Bot for a different workspace.");
  if (existing && existing.kind !== plan.botType)
    throw new Error("A Bot kind cannot change; create another Bot with the desired kind.");
  return existing;
}
