export type CommandTreeOptionKind = "flag" | "string" | "integer";

export type CommandTreeOptionSpec = {
  key: string;
  flags: readonly string[];
  kind?: CommandTreeOptionKind;
  required?: boolean;
};

export type CommandTreeHandlerParams = {
  path: readonly string[];
  rawArgs: readonly string[];
  passthroughArgs: readonly string[];
  options: Readonly<Record<string, unknown>>;
};

export type CommandTreeNodeSpec<TResult> = {
  name: string;
  aliases?: readonly string[];
  summary?: string;
  usage?: readonly string[];
  helpLines?: readonly string[];
  options?: readonly CommandTreeOptionSpec[];
  children?: readonly CommandTreeNodeSpec<TResult>[];
  passthroughArgs?: boolean;
  hiddenInHelp?: boolean;
  hiddenInUsage?: boolean;
  hiddenInCommandList?: boolean;
  handler: (params: CommandTreeHandlerParams) => TResult;
};

export type CommandTreeSpec<TResult> = {
  nodes: readonly CommandTreeNodeSpec<TResult>[];
  onEmpty: () => TResult;
};

function findNodeByToken<TResult>(
  nodes: readonly CommandTreeNodeSpec<TResult>[],
  token: string,
) {
  return nodes.find((node) => node.name === token || node.aliases?.includes(token));
}

function normalizeOptionKind(option: CommandTreeOptionSpec) {
  return option.kind ?? "string";
}

function parseCommandOptions(
  args: readonly string[],
  options: readonly CommandTreeOptionSpec[],
) {
  const parsed: Record<string, unknown> = {};
  const optionByFlag = new Map<string, CommandTreeOptionSpec>();
  for (const option of options) {
    for (const flag of option.flags) {
      optionByFlag.set(flag, option);
    }
  }

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (!token.startsWith("-")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const option = optionByFlag.get(token);
    if (!option) {
      throw new Error(`Unknown flag: ${token}`);
    }
    const kind = normalizeOptionKind(option);
    if (kind === "flag") {
      parsed[option.key] = true;
      continue;
    }
    const rawValue = args[index + 1];
    if (!rawValue) {
      throw new Error(`Missing value for ${token}`);
    }
    index += 1;
    if (kind === "integer") {
      const value = Number.parseInt(rawValue, 10);
      if (!Number.isInteger(value)) {
        throw new Error(`Invalid integer for ${token}: ${rawValue}`);
      }
      parsed[option.key] = value;
      continue;
    }
    parsed[option.key] = rawValue;
  }

  for (const option of options) {
    if (option.required && parsed[option.key] === undefined) {
      throw new Error(`Missing required flag: ${option.flags[0]}`);
    }
    if (normalizeOptionKind(option) === "flag" && parsed[option.key] === undefined) {
      parsed[option.key] = false;
    }
  }

  return parsed;
}

export function executeCommandTree<TResult>(
  args: readonly string[],
  spec: CommandTreeSpec<TResult>,
) {
  if (args.length === 0) {
    return spec.onEmpty();
  }

  let nodes = spec.nodes;
  let currentNode: CommandTreeNodeSpec<TResult> | null = null;
  const path: string[] = [];
  let index = 0;

  while (index < args.length) {
    const token = args[index]!;
    const matched = findNodeByToken(nodes, token);
    if (!matched) {
      if (!currentNode) {
        throw new Error(`Unknown command: ${token}`);
      }
      break;
    }
    currentNode = matched;
    path.push(matched.name);
    index += 1;
    nodes = matched.children ?? [];
  }

  if (!currentNode) {
    throw new Error(`Unknown command: ${args[0]}`);
  }

  const remainingArgs = args.slice(index);
  if (
    !currentNode.passthroughArgs &&
    remainingArgs.length === 1 &&
    (remainingArgs[0] === "--help" || remainingArgs[0] === "-h")
  ) {
    return spec.onEmpty();
  }
  const parsedOptions = currentNode.passthroughArgs
    ? {}
    : parseCommandOptions(remainingArgs, currentNode.options ?? []);

  return currentNode.handler({
    path,
    rawArgs: args,
    passthroughArgs: remainingArgs,
    options: parsedOptions,
  });
}

export function renderCommandTreeUsageLines<TResult>(
  spec: CommandTreeSpec<TResult>,
  commandPrefix: string,
) {
  const lines: string[] = [];
  for (const node of spec.nodes) {
    if (node.hiddenInHelp || node.hiddenInUsage) {
      continue;
    }
    const variants = node.usage?.length ? node.usage : [node.name];
    for (const variant of variants) {
      lines.push(`  ${commandPrefix} ${variant}`.trimEnd());
    }
  }
  return lines;
}

export function renderCommandTreeCommandLines<TResult>(
  spec: CommandTreeSpec<TResult>,
  renderInlineText?: (text: string) => string,
) {
  const lines: string[] = [];
  for (const node of spec.nodes) {
    if (node.hiddenInHelp || node.hiddenInCommandList || !node.summary) {
      continue;
    }
    const summaryLine = `  ${node.name.padEnd(18, " ")}${node.summary}`;
    lines.push(renderInlineText ? renderInlineText(summaryLine) : summaryLine);
    for (const helpLine of node.helpLines ?? []) {
      lines.push(
        renderInlineText ? renderInlineText(helpLine) : helpLine,
      );
    }
  }
  return lines;
}
