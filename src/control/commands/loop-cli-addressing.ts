import type {
  MessageChannel,
  MessageChildSurfaceSelector,
} from "../../channels/message/message-command.ts";
import {
  listKnownChildSurfaceFlags,
  parseChildSurfaceSelector,
} from "../../channels/message/message-surface-helpers.ts";
import {
  isRegisteredChannelId,
  listChannelPlugins,
  renderChannelRequirementMessage,
} from "../../channels/catalog/registry.ts";
import type { ChannelLoopCliAddressingState } from "../../channels/integration/channel-plugin.ts";

export type LoopCliAddressing = ChannelLoopCliAddressingState;

const BASE_LOOP_CONTEXT_FLAGS = new Set([
  "--channel",
  "--target",
  "--bot",
  "--account",
  "--timezone",
]);

function isLoopContextValueFlag(flag: string) {
  return BASE_LOOP_CONTEXT_FLAGS.has(flag) || listKnownChildSurfaceFlags().includes(flag);
}

function parseOptionValues(args: string[], name: string) {
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

export function parseOptionValue(args: string[], name: string) {
  return parseOptionValues(args, name).at(-1);
}

export function parseBotOptionValue(args: string[]) {
  const botId = parseOptionValue(args, "--bot");
  const accountId = parseOptionValue(args, "--account");
  if (botId && accountId) {
    throw new Error("--bot and --account are aliases; use only one");
  }
  return botId ?? accountId;
}

export function hasFlag(args: string[], flag: string) {
  return args.includes(flag);
}

export function stripLoopContextArgs(args: string[]) {
  const remaining: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--") {
      remaining.push(...args.slice(index + 1));
      break;
    }
    if (isLoopContextValueFlag(current)) {
      index += 1;
      continue;
    }
    remaining.push(current);
  }
  return listChannelPlugins().reduce(
    (currentArgs, plugin) => plugin.loopCli?.stripExpressionArgs?.(currentArgs) ?? currentArgs,
    remaining,
  );
}

export function parseAddressing(
  args: string[],
  intent: "help" | "create" | "list" | "status" | "cancel" = "create",
): LoopCliAddressing {
  if (parseOptionValue(args, "--surface") || parseOptionValue(args, "--session-key")) {
    throw new Error("Loop commands use --channel/--target addressing; --surface and --session-key are not supported.");
  }
  const channel = parseOptionValue(args, "--channel");
  if (channel && !isRegisteredChannelId(channel)) {
    throw new Error(renderChannelRequirementMessage("--channel"));
  }

  const addressing: LoopCliAddressing = {
    channel: channel as MessageChannel | undefined,
    target: parseOptionValue(args, "--target"),
    childSurface: parseChildSurfaceSelector({
      args,
      channel: channel as LoopCliAddressing["channel"],
      scopeLabel: "loop commands",
      allowAliasFlags: true,
    }),
    botId: parseBotOptionValue(args),
    provisionChildSurface: false,
  };

  return listChannelPlugins().reduce(
    (currentAddressing, plugin) =>
      plugin.loopCli?.resolveAddressing?.({
        intent,
        args,
        addressing: currentAddressing,
      }) ?? currentAddressing,
    addressing,
  );
}

export function hasLoopContext(args: string[]) {
  return Boolean(parseOptionValue(args, "--channel") || parseOptionValue(args, "--target"));
}
