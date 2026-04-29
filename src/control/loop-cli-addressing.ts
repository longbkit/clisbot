export type LoopCliAddressing = {
  channel?: "slack" | "telegram";
  target?: string;
  threadId?: string;
  topicId?: string;
  botId?: string;
  newThread: boolean;
};

const LOOP_CONTEXT_FLAGS = new Set([
  "--channel",
  "--target",
  "--thread-id",
  "--topic-id",
  "--bot",
  "--account",
  "--timezone",
]);

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
    if (current === "--new-thread") {
      continue;
    }
    if (LOOP_CONTEXT_FLAGS.has(current)) {
      index += 1;
      continue;
    }
    remaining.push(current);
  }
  return remaining;
}

export function parseAddressing(args: string[]): LoopCliAddressing {
  const channel = parseOptionValue(args, "--channel");
  if (channel && channel !== "slack" && channel !== "telegram") {
    throw new Error("--channel must be `slack` or `telegram`.");
  }

  const threadId = parseOptionValue(args, "--thread-id");
  const topicId = parseOptionValue(args, "--topic-id");
  if (threadId && topicId) {
    throw new Error("Use only one of `--thread-id` or `--topic-id`.");
  }

  if (channel === "slack" && topicId) {
    throw new Error("Slack loop commands use `--thread-id`, not `--topic-id`.");
  }

  return {
    channel: channel as LoopCliAddressing["channel"],
    target: parseOptionValue(args, "--target"),
    threadId,
    topicId: topicId ?? (channel === "telegram" ? threadId : undefined),
    botId: parseOptionValue(args, "--bot") ?? parseOptionValue(args, "--account"),
    newThread: hasFlag(args, "--new-thread"),
  };
}

export function hasLoopContext(args: string[]) {
  return Boolean(parseOptionValue(args, "--channel") || parseOptionValue(args, "--target"));
}

export function resolveLoopSubtargetId(addressing: LoopCliAddressing) {
  return addressing.channel === "telegram" ? addressing.topicId : addressing.threadId;
}
