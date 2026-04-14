import type { FollowUpMode } from "./follow-up-policy.ts";
import { parseCommandDurationMs } from "./run-observation.ts";
import {
  LOOP_ALL_FLAG,
  LOOP_APP_FLAG,
  LOOP_FORCE_FLAG,
  hasLoopFlag,
  parseLoopSlashCommand,
  renderLoopHelpLines,
  type ParsedLoopSlashCommand,
} from "./loop-command.ts";

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
  | "attach"
  | "detach"
  | "watch"
  | "stop"
  | "nudge"
  | "followup"
  | "responsemode"
  | "additionalmessagemode"
  | "queue-list"
  | "queue-clear"
  | "loop";
export type AgentFollowUpSlashAction = "status" | "auto" | "mention-only" | "pause" | "resume";
export type AgentResponseModeSlashAction = "status" | "capture-pane" | "message-tool";
export type AgentAdditionalMessageModeSlashAction = "status" | "queue" | "steer";

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
      name: "attach";
    }
  | {
      type: "control";
      name: "detach";
    }
  | {
      type: "control";
      name: "watch";
      intervalMs: number;
      durationMs?: number;
    }
  | {
      type: "control";
      name: "stop";
    }
  | {
      type: "control";
      name: "nudge";
    }
  | {
      type: "control";
      name: "followup";
      action: AgentFollowUpSlashAction;
      mode?: FollowUpMode;
    }
  | {
      type: "control";
      name: "responsemode";
      action: AgentResponseModeSlashAction;
      responseMode?: "capture-pane" | "message-tool";
    }
  | {
      type: "control";
      name: "additionalmessagemode";
      action: AgentAdditionalMessageModeSlashAction;
      additionalMessageMode?: "queue" | "steer";
    }
  | {
      type: "control";
      name: "queue-list";
    }
  | {
      type: "control";
      name: "queue-clear";
    };

export type AgentSlashCommand =
  | AgentControlSlashCommand
  | {
      type: "loop-control";
      action: "status";
    }
  | {
      type: "loop-control";
      action: "cancel";
      loopId?: string;
      all: boolean;
      app: boolean;
    }
  | {
      type: "loop";
      params: ParsedLoopSlashCommand;
    }
  | {
      type: "loop-error";
      message: string;
    }
  | {
      type: "queue";
      text: string;
    }
  | {
      type: "steer";
      text: string;
    }
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

  if (lowered === "attach") {
    return {
      type: "control",
      name: "attach",
    };
  }

  if (lowered === "detach") {
    return {
      type: "control",
      name: "detach",
    };
  }

  if (lowered === "watch") {
    const parsed = parseWatchCommand(withoutSlash.slice(command.length).trim());
    if (parsed) {
      return {
        type: "control",
        name: "watch",
        intervalMs: parsed.intervalMs,
        durationMs: parsed.durationMs,
      };
    }

    return {
      type: "control",
      name: "help",
    };
  }

  if (lowered === "stop") {
    return {
      type: "control",
      name: "stop",
    };
  }

  if (lowered === "nudge") {
    return {
      type: "control",
      name: "nudge",
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

  if (lowered === "responsemode") {
    const action = withoutSlash.slice(command.length).trim().toLowerCase();
    if (!action || action === "status") {
      return {
        type: "control",
        name: "responsemode",
        action: "status",
      };
    }

    if (action === "capture-pane" || action === "message-tool") {
      return {
        type: "control",
        name: "responsemode",
        action,
        responseMode: action,
      };
    }

    return {
      type: "control",
      name: "responsemode",
      action: "status",
    };
  }

  if (lowered === "additionalmessagemode") {
    const action = withoutSlash.slice(command.length).trim().toLowerCase();
    if (!action || action === "status") {
      return {
        type: "control",
        name: "additionalmessagemode",
        action: "status",
      };
    }

    if (action === "queue" || action === "steer") {
      return {
        type: "control",
        name: "additionalmessagemode",
        action,
        additionalMessageMode: action,
      };
    }

    return {
      type: "control",
      name: "additionalmessagemode",
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

  if (lowered === "queue-list" || lowered === "queuelist") {
    return {
      type: "control",
      name: "queue-list",
    };
  }

  if (lowered === "queue-clear" || lowered === "queueclear") {
    return {
      type: "control",
      name: "queue-clear",
    };
  }

  if (lowered === "loop") {
    const loopText = withoutSlash.slice(command.length).trim();
    const loweredLoopText = loopText.toLowerCase();
    if (loweredLoopText === "status") {
      return {
        type: "loop-control",
        action: "status",
      };
    }

    if (loweredLoopText === "cancel" || loweredLoopText.startsWith("cancel ")) {
      const cancelArgs = loopText.slice("cancel".length).trim();
      if (hasLoopFlag(cancelArgs, LOOP_FORCE_FLAG)) {
        return {
          type: "loop-error",
          message: `Use \`/loop cancel --all ${LOOP_APP_FLAG}\` for app-wide cancellation.`,
        };
      }
      const all = hasLoopFlag(cancelArgs, LOOP_ALL_FLAG);
      const app = hasLoopFlag(cancelArgs, LOOP_APP_FLAG);
      if (app && !all) {
        return {
          type: "loop-error",
          message: `\`${LOOP_APP_FLAG}\` only works with \`/loop cancel ${LOOP_ALL_FLAG}\`.`,
        };
      }
      const loopId = cancelArgs
        .split(/\s+/)
        .map((token) => token.trim())
        .find((token) => token && token !== LOOP_ALL_FLAG && token !== LOOP_APP_FLAG);
      return {
        type: "loop-control",
        action: "cancel",
        loopId: loopId || undefined,
        all,
        app,
      };
    }

    const parsed = parseLoopSlashCommand(loopText);
    if ("error" in parsed) {
      return {
        type: "loop-error",
        message: parsed.error,
      };
    }
    return {
      type: "loop",
      params: parsed,
    };
  }

  if (lowered === "queue" || lowered === "q") {
    return {
      type: "queue",
      text: withoutSlash.slice(command.length).trim(),
    };
  }

  if (lowered === "steer" || lowered === "s") {
    return {
      type: "steer",
      text: withoutSlash.slice(command.length).trim(),
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
    "- `/transcript`: show the current conversation session transcript when the route verbose policy allows it",
    "- `/attach`: attach this thread to the active run and resume live updates when it is still processing",
    "- `/detach`: stop live updates for this thread while still allowing final settlement here",
    "- `/watch every 30s [for 10m]`: post the latest state on an interval until the run settles or the watch window ends",
    "- `/stop`: send Escape to interrupt the current conversation session",
    "- `/nudge`: send one extra Enter to the current tmux session without resending the prompt text",
    "- `/followup status`: show the current conversation follow-up policy",
    "- `/followup auto`: allow natural follow-up after the bot has replied in-thread",
    "- `/followup mention-only`: require explicit mention for each later turn",
    "- `/followup pause`: stop passive follow-up until the next explicit mention",
    "- `/followup resume`: clear the runtime override and restore config defaults",
    "- `/responsemode status`: show the configured response mode for this surface",
    "- `/responsemode capture-pane`: settle replies from captured pane output for this surface",
    "- `/responsemode message-tool`: expect the agent to reply through `clisbot message send` for this surface",
    "- `/additionalmessagemode status`: show how extra messages behave while a run is already active",
    "- `/additionalmessagemode steer`: send later user messages straight into the active session",
    "- `/additionalmessagemode queue`: queue later user messages behind the active run for this surface",
    "- `/queue <message>` or `\\q <message>`: enqueue a later message behind the active run and let clisbot deliver it in order",
    "- `/steer <message>` or `\\s <message>`: inject a steering message into the active run immediately",
    "- `/queue-list`: show queued messages that have not started yet",
    "- `/queue-clear`: clear queued messages that have not started yet",
    ...renderLoopHelpLines(),
    "- `/bash` followed by a shell command: requires `privilegeCommands.enabled: true` on the current route",
    "- shortcut prefixes such as `!` run bash when the route allows privilege commands",
    "",
    "Other slash commands are forwarded to the agent unchanged.",
  ].join("\n");
}

function parseWatchCommand(raw: string) {
  const match = raw.match(/^every\s+(\S+)(?:\s+for\s+(\S+))?$/i);
  if (!match) {
    return null;
  }

  const intervalMs = parseCommandDurationMs(match[1] ?? "");
  if (!intervalMs) {
    return null;
  }

  const durationToken = match[2];
  const parsedDurationMs = durationToken ? parseCommandDurationMs(durationToken) : null;
  if (durationToken && !parsedDurationMs) {
    return null;
  }

  return {
    intervalMs,
    durationMs: parsedDurationMs ?? undefined,
  };
}
