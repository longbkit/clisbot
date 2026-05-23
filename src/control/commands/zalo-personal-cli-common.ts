import { readFile } from "node:fs/promises";
import { resolveZaloPersonalAttachmentSource } from "../../channels/zalo-personal/attachment-source.ts";
import { loadConfig, type LoadedConfig, type LoadConfigOptions } from "../../config/core/load-config.ts";
import { resolveZaloPersonalCredentials } from "../../channels/zalo-personal/config.ts";
import {
  loginZaloPersonalFromSession,
  type ZaloPersonalClient,
} from "../../channels/zalo-personal/zca-js.ts";
import { resolveZaloPersonalSurface } from "../../channels/zalo-personal/surface.ts";

export type ZaloPersonalCliDependencies = {
  loadConfig: (configPath?: string, options?: LoadConfigOptions) => Promise<LoadedConfig>;
  login: (tokenFile: string) => Promise<ZaloPersonalClient>;
  print: (text: string) => void;
  readFile: (path: string) => Promise<string | Buffer>;
};

export const defaultZaloPersonalCliDependencies: ZaloPersonalCliDependencies = {
  loadConfig,
  login: loginZaloPersonalFromSession,
  print: (text) => console.log(text),
  readFile,
};

export type ZaloPersonalCliContext = {
  loadedConfig: LoadedConfig;
  botId: string;
  client: ZaloPersonalClient;
};

export type ParsedTarget = {
  raw: string;
  id: string;
  type: "user" | "group";
  threadType: unknown;
};

export function hasFlag(args: readonly string[], name: string) {
  return args.includes(name);
}

export function parseOptionValue(args: readonly string[], name: string) {
  const index = args.lastIndexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1]?.trim();
  if (!value) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

export function parseRepeatedOption(args: readonly string[], name: string) {
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

export function parseIntegerOption(args: readonly string[], name: string, fallback?: number) {
  const raw = parseOptionValue(args, name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} requires a non-negative integer`);
  }
  return value;
}

export function parseTrailingArgs(args: readonly string[], skipFlags = new Set<string>()) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith("-")) {
      values.push(token);
      continue;
    }
    if (token === "--json" || token === "--confirm" || skipFlags.has(token)) {
      continue;
    }
    index += 1;
  }
  return values;
}

export function requireConfirm(args: readonly string[], action: string) {
  if (!hasFlag(args, "--confirm")) {
    throw new Error(`${action} mutates Zalo Personal state and requires --confirm.`);
  }
}

export async function resolveZaloPersonalCliContext(
  args: readonly string[],
  deps: ZaloPersonalCliDependencies,
): Promise<ZaloPersonalCliContext> {
  const channel = parseOptionValue(args, "--channel");
  if (channel !== "zalo-personal") {
    throw new Error("--channel zalo-personal is required.");
  }
  const loadedConfig = await deps.loadConfig(process.env.CLISBOT_CONFIG_PATH, {
    materializeChannels: ["zalo-personal"],
  });
  const bot = resolveZaloPersonalCredentials(
    loadedConfig.raw.bots.zaloPersonal,
    parseOptionValue(args, "--bot") ?? parseOptionValue(args, "--account"),
  );
  return {
    loadedConfig,
    botId: bot.botId,
    client: await deps.login(bot.config.tokenFile),
  };
}

export function parseZaloPersonalTarget(rawTarget: string | undefined, client: ZaloPersonalClient): ParsedTarget {
  if (!rawTarget) {
    throw new Error("--target is required.");
  }
  const surface = resolveZaloPersonalSurface({ rawTarget });
  if (!surface) {
    throw new Error("Zalo Personal target must use dm:<id> or group:<id>.");
  }
  const isGroup = surface.provider.conversationKind === "group";
  return {
    raw: rawTarget,
    id: surface.provider.chatId,
    type: isGroup ? "group" : "user",
    threadType: isGroup ? client.ThreadType.Group : client.ThreadType.User,
  };
}

export function printJsonOrSummary(params: {
  json: boolean;
  value: unknown;
  summary: string[];
  print: (text: string) => void;
}) {
  params.print(
    params.json ? JSON.stringify(params.value, null, 2) : params.summary.join("\n"),
  );
}

export function routeExample(channel: "dm" | "group", id: string, botId: string) {
  return `route: clisbot routes add --channel zalo-personal ${channel}:${id} --bot ${botId}`;
}

export function normalizeDisplayName(value: any) {
  return String(value?.displayName ?? value?.zaloName ?? value?.dName ?? value?.name ?? value?.userId ?? value?.id ?? "").trim();
}

export function normalizeId(value: any) {
  return String(value?.userId ?? value?.id ?? value?.uid ?? value ?? "").replace(/_\d+$/, "").trim();
}

export function takeLimit<T>(items: T[], limit = 50) {
  return items.slice(0, Math.max(0, limit));
}

export function parseJsonOption<T = unknown>(raw: string | undefined, label: string): T | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} must be valid JSON: ${reason}`);
  }
}

export async function readAttachmentSource(pathOrUrl: string, deps: ZaloPersonalCliDependencies) {
  if (!/^https?:\/\//i.test(pathOrUrl)) {
    const data = await deps.readFile(pathOrUrl);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return await resolveZaloPersonalAttachmentSource(pathOrUrl, buffer);
  }
  return await resolveZaloPersonalAttachmentSource(pathOrUrl);
}
