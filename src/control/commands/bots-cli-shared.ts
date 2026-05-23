import { setTimeout as sleep } from "node:timers/promises";
import type { ClisbotConfig } from "../../config/core/schema.ts";
import { getConfigReloadMtimeMs } from "../../config/channels/channel-credentials.ts";
import { RuntimeHealthStore } from "../runtime/runtime-health-store.ts";
import { getRuntimeStatus } from "../runtime/runtime-process.ts";
import { addAgentToEditableConfig } from "./agents-cli.ts";

export type BotsCliDependencies = {
  getRuntimeStatus: typeof getRuntimeStatus;
  runtimeHealthStore: RuntimeHealthStore;
};

export function parseOptionValue(args: string[], name: string) {
  const index = args.findIndex((arg) => arg === name);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1]?.trim();
  if (!value) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
}

export function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

export function hasHelpFlag(args: string[]) {
  return args.includes("--help") || args.includes("-h");
}

export async function waitForReloadResult(
  configPath: string,
  deps: BotsCliDependencies,
  timeoutMs = 12_000,
) {
  const expectedMtimeMs = getConfigReloadMtimeMs(configPath);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const document = await deps.runtimeHealthStore.read();
    if (
      document.reload &&
      document.reload.reason === "watch" &&
      (document.reload.configMtimeMs ?? 0) >= expectedMtimeMs
    ) {
      return document.reload.status;
    }
    await sleep(200);
  }

  return "failed" as const;
}

export function getBotId(args: string[]) {
  return parseOptionValue(args, "--bot") ?? "default";
}

export function findLastPositionalArg(args: string[]) {
  let value: string | undefined;
  const flagsWithValue = new Set(["--channel", "--bot", "--agent", "--app-token", "--bot-token"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (flagsWithValue.has(arg)) {
      index += 1;
      continue;
    }
    if (arg?.startsWith("--")) {
      continue;
    }
    value = arg;
  }
  return value;
}

export function ensureAgentExists(config: ClisbotConfig, agentId: string) {
  if (!config.agents.list.some((entry) => entry.id === agentId)) {
    throw new Error(`Unknown agent: ${agentId}`);
  }
}

export function getMutuallyExclusiveAgentArgs(args: string[]) {
  const agentId = parseOptionValue(args, "--agent");
  const cliTool = parseOptionValue(args, "--cli");
  const botType = parseOptionValue(args, "--bot-type");

  if (agentId && (cliTool || botType)) {
    throw new Error("Use either --agent or --cli with --bot-type, not both.");
  }

  if ((cliTool && !botType) || (!cliTool && botType)) {
    throw new Error("When creating a new bot agent, pass both --cli and --bot-type.");
  }

  return { agentId, cliTool, botType };
}

export async function maybeCreateBotAgent(
  configPath: string,
  botId: string,
  cliTool?: string,
  botType?: string,
) {
  if (!cliTool && !botType) {
    return undefined;
  }

  if (cliTool !== "codex" && cliTool !== "claude" && cliTool !== "gemini") {
    throw new Error("Bot agent CLI must be one of: codex, claude, gemini.");
  }
  if (botType !== "personal" && botType !== "team") {
    throw new Error("Bot agent type must be `personal` or `team`.");
  }

  await addAgentToEditableConfig({
    configPath,
    agentId: botId,
    cliTool,
    bootstrap: botType === "personal" ? "personal-assistant" : "team-assistant",
  });

  return botId;
}
