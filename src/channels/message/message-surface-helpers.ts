import type {
  MessageChannel,
  MessageChildSurfaceKind,
  MessageChildSurfaceSelector,
  ParsedMessageCommand,
} from "./message-command.ts";
import { renderChannelLabel } from "../catalog/registry.ts";
import { getChannelPlugin, listChannelPlugins } from "../catalog/registry.ts";

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

export function parseOptionValue(args: string[], name: string) {
  return parseRepeatedOption(args, name).at(-1);
}

export function parseChildSurfaceSelector(params: {
  args: string[];
  channel?: MessageChannel;
  scopeLabel: string;
  allowAliasFlags?: boolean;
}) {
  const valuesByFlag = new Map<string, string>();
  for (const flag of listKnownChildSurfaceFlags()) {
    const value = parseOptionValue(params.args, flag);
    if (value) {
      valuesByFlag.set(flag, value);
    }
  }
  return resolveChildSurfaceSelector({
    channel: params.channel,
    scopeLabel: params.scopeLabel,
    valuesByFlag,
    allowAliasFlags: params.allowAliasFlags,
  });
}

export function resolveChildSurfaceSelector(params: {
  channel?: MessageChannel;
  scopeLabel: string;
  valuesByFlag: ReadonlyMap<string, string>;
  allowAliasFlags?: boolean;
}): MessageChildSurfaceSelector | undefined {
  if (params.valuesByFlag.size > 1) {
    throw new Error("Use only one channel child-surface flag at a time.");
  }

  if (!params.channel) {
    const entry = params.valuesByFlag.entries().next().value as [string, string] | undefined;
    if (!entry) {
      return undefined;
    }
    const [flag, value] = entry;
    const cli = listChannelPlugins()
      .map((plugin) => plugin.childSurfaceCli)
      .find((childSurfaceCli) =>
        childSurfaceCli
        && (childSurfaceCli.primaryFlag === flag || childSurfaceCli.aliasFlags?.includes(flag))
      );
    return cli
      ? {
        kind: cli.kind,
        providerId: value,
      }
      : undefined;
  }

  const childSurfaceCli = getChannelPlugin(params.channel)?.childSurfaceCli;
  if (!childSurfaceCli) {
    if (params.valuesByFlag.size > 0) {
      throw new Error(
        `${renderChannelLabel(params.channel)} ${params.scopeLabel} do not support channel child-surface flags.`,
      );
    }
    return undefined;
  }

  const primaryValue = params.valuesByFlag.get(childSurfaceCli.primaryFlag);
  if (primaryValue) {
    return {
      kind: childSurfaceCli.kind,
      providerId: primaryValue,
    };
  }

  const alternateEntry = params.valuesByFlag.entries().next().value as [string, string] | undefined;
  if (!alternateEntry) {
    return undefined;
  }
  const [alternateFlag, alternateValue] = alternateEntry;
  const supportsAlias = childSurfaceCli.aliasFlags?.includes(alternateFlag) ?? false;
  if (supportsAlias && params.allowAliasFlags) {
    return {
      kind: childSurfaceCli.kind,
      providerId: alternateValue,
    };
  }
  throw new Error(
    `${renderChannelLabel(params.channel)} ${params.scopeLabel} use \`${childSurfaceCli.primaryFlag}\`, not \`${alternateFlag}\`.`,
  );
}

export function listKnownChildSurfaceFlags(channel?: MessageChannel) {
  if (channel) {
    const childSurfaceCli = getChannelPlugin(channel)?.childSurfaceCli;
    return childSurfaceCli
      ? [childSurfaceCli.primaryFlag, ...(childSurfaceCli.aliasFlags ?? [])]
      : [];
  }
  return Array.from(new Set(
    listChannelPlugins().flatMap((plugin) =>
      plugin.childSurfaceCli
        ? [plugin.childSurfaceCli.primaryFlag, ...(plugin.childSurfaceCli.aliasFlags ?? [])]
        : [],
    ),
  ));
}

export function getCommandThreadId(command: Pick<ParsedMessageCommand, "childSurface">) {
  return command.childSurface?.kind === "thread"
    ? command.childSurface.providerId
    : undefined;
}

export function getCommandTopicId(command: Pick<ParsedMessageCommand, "childSurface">) {
  return command.childSurface?.kind === "topic"
    ? command.childSurface.providerId
    : undefined;
}

export function renderChildSurfaceFlag(params: {
  channel: MessageChannel;
  kind: MessageChildSurfaceKind;
}) {
  const childSurfaceCli = getChannelPlugin(params.channel)?.childSurfaceCli;
  if (!childSurfaceCli) {
    throw new Error(
      `${renderChannelLabel(params.channel)} does not support channel child-surface flags.`,
    );
  }
  if (childSurfaceCli.kind !== params.kind) {
    throw new Error(
      `${renderChannelLabel(params.channel)} does not support child-surface kind ${params.kind}.`,
    );
  }
  return childSurfaceCli.primaryFlag;
}
