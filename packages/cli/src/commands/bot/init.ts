import { ownerBootstrapEnvironment } from "./owner-bootstrap.js";
import type { Command } from "commander";
import { withOutput, type OutputSchema } from "../../output/index.js";
import type { BotStartReport, BotStartDeps } from "./run.js";
import { readBotManifest, assertBotName } from "./manifest.js";
import { createBotStartDeps } from "./run.js";
import { buildAssistantPlan, type BotStartOptions } from "./plan.js";
import { provisionAssistant } from "./assistant-workspace.js";
import { resolveBotHome } from "./home.js";
import { startCommand, runStartCommand, extractBotStartOptions } from "./start.js";

/** API-first init: channel credentials opt into the same complete bot flow. */
export function onboardingInitCommand(): Command {
  return startCommand()
    .name("init")
    .description(
      "Initialize a seeded assistant workspace and configure any supplied channel credentials",
    )
    .action(
      withOutput<BotStartReport | AssistantInitReport, []>(async (options, command) => {
        const input = extractBotStartOptions(options);
        const home = resolveBotHome(options);
        const name = input.botName ?? `${input.botType ?? "personal"}-assistant`;
        assertBotName(name);
        const saved = await readBotManifest(home, name);
        if (
          input.telegramConnectionId ||
          input.telegramBotToken ||
          input.slackConnectionId ||
          input.slackBotToken ||
          input.slackAppToken ||
          saved
        ) {
          return runStartCommand(
            { ...options, ...(!saved && !input.provider ? { provider: "codex" } : {}) },
            command,
          );
        }
        return {
          type: "single",
          data: await initializeAssistantWorkspace(input, home),
          schema: initSchema,
        };
      }),
    );
}

type AssistantInitReport = Awaited<ReturnType<typeof initializeAssistantWorkspace>>;
const initSchema: OutputSchema<AssistantInitReport> = {
  idField: "workspaceId",
  columns: [],
  renderHuman: (result) => {
    if (result.type !== "single") return "";
    const assistant = result.data;
    return [
      `Assistant workspace ready: ${assistant.workspacePath}`,
      `  project ${assistant.projectId}; workspace ${assistant.workspaceId}`,
      `  agent ${assistant.agentId}; Hub ${assistant.hubUrl}`,
      `  template created: ${assistant.template?.created.join(", ") || "none"}; preserved: ${assistant.template?.skipped.join(", ") || "none"}`,
      ...(assistant.template?.backupDirectory
        ? [
            `  template overwritten: ${assistant.template.overwritten?.length ?? 0}; backup: ${assistant.template.backupDirectory}`,
          ]
        : []),
      assistant.nextStep,
    ].join("\n");
  },
};

export async function initializeAssistantWorkspace(
  options: BotStartOptions,
  home: string,
  deps: BotStartDeps = createBotStartDeps(home, process.env),
  inheritedEnv: NodeJS.ProcessEnv = process.env,
) {
  const env = ownerBootstrapEnvironment(options, inheritedEnv);
  const plan = buildAssistantPlan({ ...options, provider: options.provider ?? "codex" }, home);
  assertBotName(plan.name);
  await deps.ensureDaemonUp(home, env);
  await deps.waitDaemonUp(home);
  const client = await deps.openDaemon(deps.daemonHost(home, env), deps.daemonPassword(home));
  try {
    const assistant = await provisionAssistant(client, deps, plan, env);
    const hub = await deps.ensureHubUp(home, env);
    await deps.waitHubReady(hub.url);
    return {
      ...assistant,
      hubUrl: hub.url,
      nextStep:
        "Open your assistant in the app. For channel chat, finish Account setup at the Hub URL if needed, then run hub init or bot start with channel credentials.",
    };
  } finally {
    await deps.closeDaemon(client);
  }
}
