import { applyTemplate, expandHomePath } from "../shared/paths.ts";
import {
  buildRunnerFromToolTemplate,
  DEFAULT_AGENT_TOOL_TEMPLATES,
  type AgentBootstrapMode,
  type AgentCliToolId,
  inferAgentCliToolId,
} from "../config/agent-tool-presets.ts";
import { type ClisbotConfig } from "../config/schema.ts";
import { parseTimezone } from "../config/timezone.ts";
import { readEditableConfig, writeEditableConfig } from "../config/config-file.ts";
import { applyBootstrapTemplate, getBootstrapWorkspaceState } from "../agents/bootstrap.ts";
import { parseBotType } from "./channel-bootstrap-flags.ts";
import type {
  AdditionalMessageMode,
  ResponseMode,
} from "../channels/mode-config-shared.ts";
import { renderCliCommand } from "../shared/cli-name.ts";

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

type AgentBindingTarget = {
  channel: "slack" | "telegram";
  accountId?: string;
};

function parseBinding(raw: string): AgentBindingTarget {
  const [channel, accountId] = raw.split(":", 2);
  if (channel !== "slack" && channel !== "telegram") {
    throw new Error(`Unsupported binding channel: ${channel}`);
  }

  return {
    channel,
    accountId: accountId?.trim() || undefined,
  };
}

function parseRepeatedOption(args: string[], name: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue;
    }

    const value = args[index + 1]?.trim();
    if (!value) {
      throw new Error(`Missing value for ${name}`);
    }
    values.push(value);
  }

  return values;
}

function parseSingleOption(args: string[], name: string) {
  const values = parseRepeatedOption(args, name);
  if (values.length === 0) {
    return undefined;
  }
  return values[values.length - 1];
}

function hasFlag(args: string[], name: string) {
  return args.includes(name);
}

function renderAgentsHelp() {
  return [
    renderCliCommand("agents"),
    "",
    "Usage:",
    `  ${renderCliCommand("agents --help")}`,
    `  ${renderCliCommand("agents help")}`,
    `  ${renderCliCommand("agents list [--json]")}`,
    `  ${renderCliCommand("agents add <id> --cli <codex|claude|gemini> [--workspace <path>] [--startup-option <arg>]... [--bot-type <personal|team>]")}`,
    `  ${renderCliCommand("agents bootstrap <id> --bot-type <personal|team> [--force]")}`,
    `  ${renderCliCommand("agents response-mode <status|set|clear> --agent <id> [capture-pane|message-tool]")}`,
    `  ${renderCliCommand("agents additional-message-mode <status|set|clear> --agent <id> [queue|steer]")}`,
    `  ${renderCliCommand("agents get-timezone --agent <id>")}`,
    `  ${renderCliCommand("agents set-timezone --agent <id> <iana-timezone>")}`,
    `  ${renderCliCommand("agents clear-timezone --agent <id>")}`,
    "",
    "Notes:",
    `  - \`agents add\` is the lower-level manual surface; first-run ${renderCliCommand("start", { inline: true })} and ${renderCliCommand("init", { inline: true })} can bootstrap the first \`default\` agent for you`,
    "  - `--cli` is required on `agents add`; supported tools are `codex`, `claude`, and `gemini`",
    "  - omit `--startup-option` to inherit the built-in startup args for the selected CLI tool",
    "  - `response-mode` and `additional-message-mode` mutate per-agent overrides under `agents.list[]`",
    "  - use agent timezone only when one workspace/assistant should run wall-clock loops in a different timezone than app default",
  ].join("\n");
}

function parseResponseMode(raw: string | undefined): ResponseMode {
  if (raw === "capture-pane" || raw === "message-tool") {
    return raw;
  }
  throw new Error("Usage: agents response-mode <status|set|clear> ...");
}

function parseAdditionalMessageMode(raw: string | undefined): AdditionalMessageMode {
  if (raw === "queue" || raw === "steer") {
    return raw;
  }
  throw new Error("Usage: agents additional-message-mode <status|set|clear> ...");
}

function removeConsumedArgs(args: string[], consumedNames: string[]) {
  const names = new Set(consumedNames);
  const remaining: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!names.has(arg)) {
      remaining.push(arg);
      continue;
    }

    index += 1;
  }

  return remaining;
}

function resolveWorkspacePath(config: ClisbotConfig, agentId: string, customWorkspace?: string) {
  const template = customWorkspace ?? config.agents.defaults.workspace;
  return expandHomePath(
    applyTemplate(template, {
      agentId,
    }),
  );
}

function areStringArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function areJsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export type AddAgentParams = {
  configPath?: string;
  agentId: string;
  cliTool: AgentCliToolId;
  workspace?: string;
  startupOptions?: string[];
  bootstrap?: AgentBootstrapMode;
};

function ensureAgentMissing(config: ClisbotConfig, agentId: string) {
  if (config.agents.list.some((entry) => entry.id === agentId)) {
    throw new Error(`Agent already exists: ${agentId}`);
  }
}

function getAgentEntry(config: ClisbotConfig, agentId: string) {
  return config.agents.list.find((entry) => entry.id === agentId);
}

function ensureAgentExists(config: ClisbotConfig, agentId: string) {
  const entry = getAgentEntry(config, agentId);
  if (!entry) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  return entry;
}

function resolveAgentTool(config: ClisbotConfig, agentId: string) {
  const entry = ensureAgentExists(config, agentId);
  const cliTool = entry.cli ?? inferAgentCliToolId(entry.runner?.command);
  if (!cliTool) {
    throw new Error(`Unable to infer CLI tool for agent: ${agentId}`);
  }

  return cliTool;
}

async function listAgents(args: string[]) {
  const { config } = await readEditableConfig(getEditableConfigPath());
  const printJson = hasFlag(args, "--json");

  const summaries = config.agents.list.map((agent) => ({
    id: agent.id,
    cliTool:
      agent.cli ??
      inferAgentCliToolId(agent.runner?.command) ??
      config.agents.defaults.cli,
    responseMode: agent.responseMode,
    additionalMessageMode: agent.additionalMessageMode,
    workspace:
      agent.workspace ??
      config.agents.defaults.workspace.replaceAll("{agentId}", agent.id),
    startupOptions: agent.runner?.args,
    bootstrapMode: agent.bootstrap?.botType,
    bootstrapState: getBootstrapWorkspaceState(
      resolveWorkspacePath(config, agent.id, agent.workspace),
      agent.bootstrap?.botType,
      agent.cli ?? inferAgentCliToolId(agent.runner?.command) ?? undefined,
    ),
  }));

  if (printJson) {
    console.log(JSON.stringify(summaries, null, 2));
    return;
  }

  if (summaries.length === 0) {
    console.log("No agents configured.");
    return;
  }

  console.log("Configured agents:");
  for (const summary of summaries) {
    const parts = [
      `- ${summary.id}`,
      `tool=${summary.cliTool}`,
      `workspace=${summary.workspace}`,
      `responseMode=${summary.responseMode ?? "inherit"}`,
      `additionalMessageMode=${summary.additionalMessageMode ?? "inherit"}`,
    ];
    if (summary.bootstrapMode) {
      parts.push(`bootstrap=${summary.bootstrapMode}:${summary.bootstrapState}`);
    }
    console.log(parts.join(" "));
  }
}

export async function addAgentToEditableConfig(params: AddAgentParams) {
  const { config, configPath } = await readEditableConfig(params.configPath ?? getEditableConfigPath());
  ensureAgentMissing(config, params.agentId);

  const cliTool = params.cliTool;
  const toolTemplate = DEFAULT_AGENT_TOOL_TEMPLATES[cliTool];
  const resolvedStartupOptions =
    params.startupOptions && params.startupOptions.length > 0
      ? params.startupOptions
      : toolTemplate.startupOptions;
  const runner = buildRunnerFromToolTemplate(cliTool, toolTemplate, resolvedStartupOptions);
  const workspacePath = resolveWorkspacePath(config, params.agentId, params.workspace);
  const defaultRunner = config.agents.defaults.runner[cliTool];
  const runnerOverride = areJsonEqual(runner, defaultRunner)
    ? undefined
    : runner;

  if (params.bootstrap) {
    await applyBootstrapTemplate(workspacePath, params.bootstrap, cliTool);
  }

  config.agents.list.push({
    id: params.agentId,
    cli: cliTool,
    workspace: params.workspace,
    bootstrap: params.bootstrap ? { botType: params.bootstrap } : undefined,
    runner: runnerOverride,
  });

  await writeEditableConfig(configPath, config);

  return {
    configPath,
    workspacePath,
    startupOptions: resolvedStartupOptions,
  };
}

async function addAgent(args: string[]) {
  const agentId = args[0]?.trim();
  if (!agentId) {
    throw new Error("Usage: agents add <id> --cli <codex|claude|gemini> [--workspace <path>] [--startup-option <arg>]... [--bot-type <personal|team>] [--bind <channel[:accountId]>]...");
  }
  if (hasFlag(args, "--bootstrap")) {
    throw new Error("agents add no longer accepts --bootstrap; use --bot-type personal or --bot-type team");
  }
  if (hasFlag(args, "--mode")) {
    throw new Error("agents add does not use --mode; use --bot-type personal or --bot-type team");
  }

  const cliTool = parseSingleOption(args, "--cli") as AgentCliToolId | undefined;
  if (!cliTool || !(cliTool in DEFAULT_AGENT_TOOL_TEMPLATES)) {
    throw new Error("agents add requires --cli codex, --cli claude, or --cli gemini");
  }

  const workspace = parseSingleOption(args, "--workspace");
  const startupOptions = parseRepeatedOption(args, "--startup-option");
  let bootstrap: AgentBootstrapMode | undefined;
  const botType = parseSingleOption(args, "--bot-type");
  if (botType) {
    bootstrap = parseBotType(botType);
  }

  const result = await addAgentToEditableConfig({
    agentId,
    cliTool,
    workspace,
    startupOptions,
    bootstrap,
  });

  console.log(`Added agent ${agentId} with tool ${cliTool}.`);
  if (bootstrap) {
    console.log(
      `Bootstrap files seeded for ${bootstrap} in ${result.workspacePath}`,
    );
  }
}

async function bootstrapAgent(args: string[]) {
  const agentId = args[0]?.trim();
  if (!agentId) {
    throw new Error(
      "Usage: agents bootstrap <id> --bot-type <personal|team> [--force]",
    );
  }
  if (hasFlag(args, "--mode")) {
    throw new Error("agents bootstrap no longer accepts --mode; use --bot-type personal or --bot-type team");
  }
  if (hasFlag(args, "--bootstrap")) {
    throw new Error(
      "agents bootstrap does not use --bootstrap; use --bot-type personal or --bot-type team",
    );
  }

  const botType = parseSingleOption(args, "--bot-type");
  if (!botType) {
    throw new Error("agents bootstrap requires --bot-type personal or --bot-type team");
  }
  const mode = parseBotType(botType);

  const force = hasFlag(args, "--force");
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const entry = ensureAgentExists(config, agentId);
  const tool = resolveAgentTool(config, agentId);
  const workspacePath = resolveWorkspacePath(config, agentId, entry.workspace);

  await applyBootstrapTemplate(workspacePath, mode, tool, {
    force,
  });
  entry.bootstrap = {
    botType: mode,
  };
  await writeEditableConfig(configPath, config);

  console.log(
    `${force ? "Rebootstrapped" : "Bootstrapped"} agent ${agentId} with ${tool}/${mode} in ${workspacePath}.`,
  );
}

async function listBindings(args: string[]) {
  void args;
  console.log(
    `Agent bindings are no longer managed here. Use ${renderCliCommand("bots ...", { inline: true })} or ${renderCliCommand("routes ...", { inline: true })}.`,
  );
}

async function bindAgent(args: string[]) {
  void args;
  throw new Error(
    `Use ${renderCliCommand("bots set-agent ...", { inline: true })} or ${renderCliCommand("routes set-agent ...", { inline: true })} instead.`,
  );
}

async function unbindAgent(args: string[]) {
  void args;
  throw new Error(
    `Use ${renderCliCommand("bots clear-agent ...", { inline: true })} or ${renderCliCommand("routes clear-agent ...", { inline: true })} instead.`,
  );
}

async function runAgentResponseModeCli(args: string[]) {
  const action = args[0];
  if (action !== "status" && action !== "set" && action !== "clear") {
    throw new Error("Usage: agents response-mode <status|set|clear> --agent <id> [capture-pane|message-tool]");
  }

  const agentId = parseSingleOption(args, "--agent");
  if (!agentId) {
    throw new Error("Usage: agents response-mode <status|set|clear> --agent <id> [capture-pane|message-tool]");
  }

  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const agent = ensureAgentExists(config, agentId);

  if (action === "status") {
    console.log(`agent: ${agent.id}`);
    console.log(`responseMode: ${agent.responseMode ?? "(inherit)"}`);
    console.log(`config: ${configPath}`);
    return;
  }

  if (action === "clear") {
    delete agent.responseMode;
    await writeEditableConfig(configPath, config);
    console.log(`cleared responseMode for ${agent.id}`);
    console.log(`responseMode: (inherit)`);
    console.log(`config: ${configPath}`);
    return;
  }

  const responseMode = parseResponseMode(args[1]);
  agent.responseMode = responseMode;
  await writeEditableConfig(configPath, config);
  console.log(`updated responseMode for ${agent.id}`);
  console.log(`responseMode: ${responseMode}`);
  console.log(`config: ${configPath}`);
}

async function runAgentAdditionalMessageModeCli(args: string[]) {
  const action = args[0];
  if (action !== "status" && action !== "set" && action !== "clear") {
    throw new Error("Usage: agents additional-message-mode <status|set|clear> --agent <id> [queue|steer]");
  }

  const agentId = parseSingleOption(args, "--agent");
  if (!agentId) {
    throw new Error("Usage: agents additional-message-mode <status|set|clear> --agent <id> [queue|steer]");
  }

  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const agent = ensureAgentExists(config, agentId);

  if (action === "status") {
    console.log(`agent: ${agent.id}`);
    console.log(`additionalMessageMode: ${agent.additionalMessageMode ?? "(inherit)"}`);
    console.log(`config: ${configPath}`);
    return;
  }

  if (action === "clear") {
    delete agent.additionalMessageMode;
    await writeEditableConfig(configPath, config);
    console.log(`cleared additionalMessageMode for ${agent.id}`);
    console.log("additionalMessageMode: (inherit)");
    console.log(`config: ${configPath}`);
    return;
  }

  const additionalMessageMode = parseAdditionalMessageMode(args[1]);
  agent.additionalMessageMode = additionalMessageMode;
  await writeEditableConfig(configPath, config);
  console.log(`updated additionalMessageMode for ${agent.id}`);
  console.log(`additionalMessageMode: ${additionalMessageMode}`);
  console.log(`config: ${configPath}`);
}

async function runAgentTimezoneCli(
  args: string[],
  action: "get-timezone" | "set-timezone" | "clear-timezone",
) {
  const agentId = parseSingleOption(args, "--agent");
  if (!agentId) {
    throw new Error("Usage: agents <get-timezone|set-timezone|clear-timezone> --agent <id> [iana-timezone]");
  }

  const { config, configPath } = await readEditableConfig(getEditableConfigPath());
  const agent = ensureAgentExists(config, agentId);

  if (action === "get-timezone") {
    console.log(`agent: ${agent.id}`);
    console.log(`timezone: ${agent.timezone ?? "(inherit)"}`);
    console.log(`config: ${configPath}`);
    return;
  }

  if (action === "clear-timezone") {
    delete agent.timezone;
    await writeEditableConfig(configPath, config);
    console.log(`cleared timezone for ${agent.id}`);
    console.log("timezone: (inherit)");
    console.log(`config: ${configPath}`);
    return;
  }

  const timezone = parseTimezone(removeConsumedArgs(args, ["--agent"])[0]);
  agent.timezone = timezone;
  await writeEditableConfig(configPath, config);
  console.log(`set timezone for ${agent.id} to ${timezone}`);
  console.log(`config: ${configPath}`);
}

export async function runAgentsCli(args: string[]) {
  const subcommand = args[0];
  const rest = args.slice(1);

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log(renderAgentsHelp());
    return;
  }

  if (subcommand === "list") {
    await listAgents(rest);
    return;
  }

  if (subcommand === "add") {
    await addAgent(rest);
    return;
  }

  if (subcommand === "bindings") {
    await listBindings(rest);
    return;
  }

  if (subcommand === "bootstrap") {
    await bootstrapAgent(rest);
    return;
  }

  if (subcommand === "response-mode") {
    await runAgentResponseModeCli(rest);
    return;
  }

  if (subcommand === "additional-message-mode") {
    await runAgentAdditionalMessageModeCli(rest);
    return;
  }

  if (
    subcommand === "get-timezone" ||
    subcommand === "set-timezone" ||
    subcommand === "clear-timezone"
  ) {
    await runAgentTimezoneCli(rest, subcommand);
    return;
  }

  if (subcommand === "bind") {
    await bindAgent(rest);
    return;
  }

  if (subcommand === "unbind") {
    await unbindAgent(rest);
    return;
  }

  throw new Error(renderAgentsHelp());
}
