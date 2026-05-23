import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ClisbotConfig } from "../../config/core/schema.ts";
import { resolveZaloPersonalConfig } from "./config.ts";
import {
  describeZaloPersonalAuthSession,
  removeZaloPersonalAuthSession,
} from "./session-file.ts";
import { loginZaloPersonalWithQr } from "./zca-js.ts";

export type ZaloPersonalQrLoginOptions = {
  config: ClisbotConfig;
  botId: string;
  qrPath?: string;
  confirmed?: boolean;
  skipRiskConfirmation?: boolean;
};

export function renderZaloPersonalRiskWarning() {
  return [
    "WARNING: Zalo Personal uses an unofficial personal-account Zalo Web session. Use a separate phone number/Zalo account; automation can be unstable or risky.",
    "CANH BAO: Zalo Personal dung session Zalo Web tai khoan ca nhan khong chinh thuc. Nen dung so dien thoai/tai khoan Zalo rieng; automation co the khong on dinh hoac rui ro.",
  ];
}

export async function confirmZaloPersonalRisk(confirmed?: boolean) {
  for (const line of renderZaloPersonalRiskWarning()) {
    console.log(line);
  }
  if (confirmed) {
    return;
  }
  if (!input.isTTY) {
    throw new Error("Zalo Personal requires explicit approval. Re-run with --confirm after reviewing the warning.");
  }
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Type YES to continue: ");
    if (answer.trim() !== "YES") {
      throw new Error("Zalo Personal login cancelled.");
    }
  } finally {
    rl.close();
  }
}

export async function loginConfiguredZaloPersonalBot(options: ZaloPersonalQrLoginOptions) {
  if (!options.skipRiskConfirmation) {
    await confirmZaloPersonalRisk(options.confirmed);
  }
  const bot = resolveZaloPersonalConfig(options.config.bots.zaloPersonal, options.botId);
  return await loginZaloPersonalWithQr({
    tokenFile: bot.tokenFile,
    qrPath: options.qrPath,
  });
}

export async function logoutConfiguredZaloPersonalBot(config: ClisbotConfig, botId: string) {
  const bot = resolveZaloPersonalConfig(config.bots.zaloPersonal, botId);
  await removeZaloPersonalAuthSession(bot.tokenFile);
  return bot.tokenFile;
}

export async function describeConfiguredZaloPersonalBotLogin(config: ClisbotConfig, botId: string) {
  const bot = resolveZaloPersonalConfig(config.bots.zaloPersonal, botId);
  return await describeZaloPersonalAuthSession(bot.tokenFile);
}
