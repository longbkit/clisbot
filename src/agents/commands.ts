import type { FollowUpMode } from "./follow-up-policy.ts";

export type CommandPrefixes = {
  slash: string[];
  bash: string[];
};

export type AgentControlSlashCommandName =
  | "start"
  | "status"
  | "help"
  | "whoami"
  | "transcript"
  | "stop"
  | "followup";
export type AgentFollowUpSlashAction = "status" | "auto" | "mention-only" | "pause" | "resume";

export type AgentControlSlashCommand =
  | {
      type: "control";
      name: "start";
    }
  | {
      type: "control";
      name: "status";
    }
  | {
      type: "control";
      name: "help";
    }
  | {
      type: "control";
      name: "whoami";
    }
  | {
      type: "control";
      name: "transcript";
    }
  | {
      type: "control";
      name: "stop";
    }
  | {
      type: "control";
      name: "followup";
      action: AgentFollowUpSlashAction;
      mode?: FollowUpMode;
    };

export type AgentSlashCommand =
  | AgentControlSlashCommand
  | {
      type: "bash";
      command: string;
      source: "slash" | "shortcut";
    }
  | {
      type: "native";
      text: string;
    }
  | null;

export function parseAgentCommand(
  text: string,
  options: {
    botUsername?: string;
    commandPrefixes?: CommandPrefixes;
  } = {},
): AgentSlashCommand {
  const normalized = text.trim();
  const commandPrefixes = options.commandPrefixes ?? {
    slash: ["::", "\\"],
    bash: ["!"],
  };
  const bashPrefix = findMatchingPrefix(normalized, commandPrefixes.bash);
  if (bashPrefix) {
    const command = normalized.slice(bashPrefix.length).trim();
    return {
      type: "bash",
      command,
      source: "shortcut",
    };
  }

  const slashPrefix = findMatchingPrefix(normalized, ["/", ...commandPrefixes.slash]);
  if (!slashPrefix) {
    return null;
  }

  const withoutSlash = normalized.slice(slashPrefix.length).trim();
  if (!withoutSlash) {
    return {
      type: "control",
      name: "help",
    };
  }

  const [command] = withoutSlash.split(/\s+/, 1);
  const lowered = normalizeSlashCommandName(command, options.botUsername);
  if (lowered === "start") {
    return {
      type: "control",
      name: "start",
    };
  }

  if (lowered === "status") {
    return {
      type: "control",
      name: "status",
    };
  }

  if (lowered === "help") {
    return {
      type: "control",
      name: "help",
    };
  }

  if (lowered === "whoami") {
    return {
      type: "control",
      name: "whoami",
    };
  }

  if (lowered === "transcript") {
    return {
      type: "control",
      name: "transcript",
    };
  }

  if (lowered === "stop") {
    return {
      type: "control",
      name: "stop",
    };
  }

  if (lowered === "followup") {
    const action = withoutSlash.slice(command.length).trim().toLowerCase();
    if (!action || action === "status") {
      return {
        type: "control",
        name: "followup",
        action: "status",
      };
    }

    if (action === "auto") {
      return {
        type: "control",
        name: "followup",
        action: "auto",
        mode: "auto",
      };
    }

    if (action === "mention-only") {
      return {
        type: "control",
        name: "followup",
        action: "mention-only",
        mode: "mention-only",
      };
    }

    if (action === "pause") {
      return {
        type: "control",
        name: "followup",
        action: "pause",
        mode: "paused",
      };
    }

    if (action === "resume") {
      return {
        type: "control",
        name: "followup",
        action: "resume",
      };
    }

    return {
      type: "control",
      name: "followup",
      action: "status",
    };
  }

  if (lowered === "bash") {
    return {
      type: "bash",
      command: withoutSlash.slice(command.length).trim(),
      source: "slash",
    };
  }

  return {
    type: "native",
    text: normalized,
  };
}

function findMatchingPrefix(text: string, prefixes: string[]) {
  return [...prefixes]
    .sort((left, right) => right.length - left.length)
    .find((prefix) => prefix.length > 0 && text.startsWith(prefix));
}

function normalizeSlashCommandName(command: string | undefined, botUsername?: string) {
  const lowered = command?.toLowerCase() ?? "";
  const normalizedBotUsername = (botUsername ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!normalizedBotUsername) {
    return lowered;
  }

  const suffix = `@${normalizedBotUsername}`;
  if (!lowered.endsWith(suffix)) {
    return lowered;
  }

  return lowered.slice(0, lowered.length - suffix.length);
}

export function renderAgentControlSlashHelp() {
  return [
    "Slash commands",
    "",
    "- `/start`: show onboarding help for the current surface",
    "- `/status`: show the current route status and operator setup commands",
    "- `/help`: show available control slash commands",
    "- `/whoami`: show the current platform, route, and sender identity details",
    "- `/transcript`: show the current conversation session transcript when the route enables sensitive commands",
    "- `/stop`: send Escape to interrupt the current conversation session",
    "- `/followup status`: show the current conversation follow-up policy",
    "- `/followup auto`: allow natural follow-up after the bot has replied in-thread",
    "- `/followup mention-only`: require explicit mention for each later turn",
    "- `/followup pause`: stop passive follow-up until the next explicit mention",
    "- `/followup resume`: clear the runtime override and restore config defaults",
    "- `/bash` followed by a shell command: requires `privilegeCommands.enabled: true` on the current route",
    "- shortcut prefixes such as `!` run bash when the route allows privilege commands",
    "",
    "Other slash commands are forwarded to the agent unchanged.",
  ].join("\n");
}
