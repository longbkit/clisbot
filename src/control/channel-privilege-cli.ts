import { readEditableConfig, writeEditableConfig } from "../config/config-file.ts";
import { renderTelegramRouteChoiceMessage } from "../channels/telegram/route-guidance.ts";

type PrivilegeTarget =
  | "slack-dm"
  | "slack-channel"
  | "slack-group"
  | "telegram-dm"
  | "telegram-group";

function getEditableConfigPath() {
  return process.env.CLISBOT_CONFIG_PATH;
}

function parseTarget(raw: string | undefined): PrivilegeTarget {
  if (
    raw === "slack-dm" ||
    raw === "slack-channel" ||
    raw === "slack-group" ||
    raw === "telegram-dm" ||
    raw === "telegram-group"
  ) {
    return raw;
  }

  throw new Error(renderPrivilegeCliHelp());
}

function parseOptionValue(args: string[], name: string) {
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

function ensureAllowUsersList(value: { allowUsers?: string[]; enabled?: boolean } | undefined) {
  return {
    enabled: value?.enabled ?? false,
    allowUsers: value?.allowUsers ?? [],
  };
}

function renderPrivilegeCliHelp() {
  return [
    "Usage:",
    "  clisbot channels privilege enable slack-dm",
    "  clisbot channels privilege disable slack-dm",
    "  clisbot channels privilege allow-user slack-dm <userId>",
    "  clisbot channels privilege remove-user slack-dm <userId>",
    "  clisbot channels privilege enable slack-channel <channelId>",
    "  clisbot channels privilege allow-user slack-channel <channelId> <userId>",
    "  clisbot channels privilege enable slack-group <groupId>",
    "  clisbot channels privilege allow-user slack-group <groupId> <userId>",
    "  clisbot channels privilege enable telegram-dm",
    "  clisbot channels privilege allow-user telegram-dm <userId>",
    "  clisbot channels privilege enable telegram-group <chatId> [--topic <topicId>]",
    "  clisbot channels privilege allow-user telegram-group <chatId> <userId> [--topic <topicId>]",
  ].join("\n");
}

function addUniqueUser(users: string[], userId: string) {
  const normalized = userId.trim();
  return normalized && !users.includes(normalized) ? [...users, normalized] : users;
}

function removeUser(users: string[], userId: string) {
  const normalized = userId.trim();
  return users.filter((value) => value !== normalized);
}

export async function runChannelPrivilegeCli(args: string[]) {
  const action = args[0];
  const target = parseTarget(args[1]);
  const rest = args.slice(2);
  const { config, configPath } = await readEditableConfig(getEditableConfigPath());

  if (target === "slack-dm") {
    const current = ensureAllowUsersList(config.channels.slack.directMessages.privilegeCommands);
    await applyPrivilegeAction({
      action,
      current,
      args: rest,
      set: (next) => {
        config.channels.slack.directMessages.privilegeCommands = next;
      },
      configPath,
      label: "slack direct messages",
      save: async () => writeEditableConfig(configPath, config),
    });
    return;
  }

  if (target === "telegram-dm") {
    const current = ensureAllowUsersList(config.channels.telegram.directMessages.privilegeCommands);
    await applyPrivilegeAction({
      action,
      current,
      args: rest,
      set: (next) => {
        config.channels.telegram.directMessages.privilegeCommands = next;
      },
      configPath,
      label: "telegram direct messages",
      save: async () => writeEditableConfig(configPath, config),
    });
    return;
  }

  if (target === "slack-channel" || target === "slack-group") {
    const routeId = rest[0]?.trim();
    if (!routeId) {
      throw new Error(renderPrivilegeCliHelp());
    }

    const routes = target === "slack-channel"
      ? config.channels.slack.channels
      : config.channels.slack.groups;
    const route = routes[routeId];
    if (!route) {
      throw new Error(`Route not configured yet: ${target} ${routeId}. Add the route first with \`clisbot channels add ...\`.`);
    }

    const current = ensureAllowUsersList(route.privilegeCommands);
    await applyPrivilegeAction({
      action,
      current,
      args: rest.slice(1),
      set: (next) => {
        route.privilegeCommands = next;
      },
      configPath,
      label: `${target} ${routeId}`,
      save: async () => writeEditableConfig(configPath, config),
    });
    return;
  }

  const chatId = rest[0]?.trim();
  if (!chatId) {
    throw new Error(renderPrivilegeCliHelp());
  }

  const topicId = parseOptionValue(rest, "--topic");
  const group = config.channels.telegram.groups[chatId];
  if (!group) {
    throw new Error(renderTelegramRouteChoiceMessage({ chatId }));
  }

  if (topicId) {
    const topic = group.topics?.[topicId];
    if (!topic) {
      throw new Error(renderTelegramRouteChoiceMessage({ chatId, topicId }));
    }

    const current = ensureAllowUsersList(topic.privilegeCommands);
    await applyPrivilegeAction({
      action,
      current,
      args: rest.filter((value, index) => {
        if (index === 0) {
          return false;
        }
        return value !== "--topic" && value !== topicId;
      }),
      set: (next) => {
        topic.privilegeCommands = next;
      },
      configPath,
      label: `telegram topic ${chatId}/${topicId}`,
      save: async () => writeEditableConfig(configPath, config),
    });
    return;
  }

  const current = ensureAllowUsersList(group.privilegeCommands);
  await applyPrivilegeAction({
    action,
    current,
    args: rest.slice(1),
    set: (next) => {
      group.privilegeCommands = next;
    },
    configPath,
    label: `telegram group ${chatId}`,
    save: async () => writeEditableConfig(configPath, config),
  });
}

async function applyPrivilegeAction(params: {
  action: string | undefined;
  current: { enabled: boolean; allowUsers: string[] };
  args: string[];
  set: (next: { enabled: boolean; allowUsers: string[] }) => void;
  save: () => Promise<void>;
  configPath: string;
  label: string;
}) {
  if (params.action === "enable") {
    params.set({
      enabled: true,
      allowUsers: params.current.allowUsers,
    });
    await params.save();
    console.log(`enabled privilege commands for ${params.label}`);
    console.log(`config: ${params.configPath}`);
    return;
  }

  if (params.action === "disable") {
    params.set({
      enabled: false,
      allowUsers: params.current.allowUsers,
    });
    await params.save();
    console.log(`disabled privilege commands for ${params.label}`);
    console.log(`config: ${params.configPath}`);
    return;
  }

  if (params.action === "allow-user") {
    const userId = params.args[0]?.trim();
    if (!userId) {
      throw new Error(renderPrivilegeCliHelp());
    }
    params.set({
      enabled: params.current.enabled,
      allowUsers: addUniqueUser(params.current.allowUsers, userId),
    });
    await params.save();
    console.log(`allowed ${userId} to use privilege commands for ${params.label}`);
    console.log(`config: ${params.configPath}`);
    return;
  }

  if (params.action === "remove-user") {
    const userId = params.args[0]?.trim();
    if (!userId) {
      throw new Error(renderPrivilegeCliHelp());
    }
    params.set({
      enabled: params.current.enabled,
      allowUsers: removeUser(params.current.allowUsers, userId),
    });
    await params.save();
    console.log(`removed ${userId} from privilege commands for ${params.label}`);
    console.log(`config: ${params.configPath}`);
    return;
  }

  throw new Error(renderPrivilegeCliHelp());
}
