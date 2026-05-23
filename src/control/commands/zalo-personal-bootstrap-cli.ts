import type { ChannelBootstrapBotInput } from "../../config/channels/channel-bootstrap.ts";
import type { ClisbotConfig } from "../../config/core/schema.ts";
import {
  confirmZaloPersonalRisk,
  describeConfiguredZaloPersonalBotLogin,
  loginConfiguredZaloPersonalBot,
} from "../../channels/zalo-personal/login.ts";
import type { ParsedBootstrapFlags } from "./channel-bootstrap-flags.ts";

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

export async function confirmZaloPersonalBootstrapIfNeeded(
  bootstrapFlags: ParsedBootstrapFlags,
  rawArgs: string[],
) {
  if ((bootstrapFlags.bots["zalo-personal"] ?? []).length === 0) {
    return;
  }
  await confirmZaloPersonalRisk(hasFlag(rawArgs, "--confirm"));
}

export async function filterZaloPersonalBootstrapBotsNeedingLogin(
  config: ClisbotConfig,
  bots: ChannelBootstrapBotInput[],
) {
  const pending = [];
  for (const bot of bots) {
    const login = await describeConfiguredZaloPersonalBotLogin(config, bot.botId);
    if (!login.loggedIn) {
      pending.push(bot);
    }
  }
  return pending;
}

export async function loginZaloPersonalBootstrapBots(params: {
  config: ClisbotConfig;
  bootstrapFlags: ParsedBootstrapFlags;
}) {
  const bots = params.bootstrapFlags.bots["zalo-personal"] ?? [];
  const pendingBots = await filterZaloPersonalBootstrapBotsNeedingLogin(params.config, bots);
  for (const bot of pendingBots) {
    await loginConfiguredZaloPersonalBot({
      config: params.config,
      botId: bot.botId,
      qrPath: bot.qrPath,
      skipRiskConfirmation: true,
    });
  }
}
