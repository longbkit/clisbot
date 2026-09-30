import path from "node:path";
import type { Command } from "commander";
import { isCancel, password as passwordPrompt } from "@clack/prompts";
import { hashDaemonPassword } from "@clisbot/server/auth";
import {
  readPersistedConfig,
  savePersistedConfig,
  type PersistedConfig,
} from "@clisbot/server/configuration";
import { resolveClisbotHome } from "@clisbot/server/daemon-control";
import type {
  CommandError,
  CommandOptions,
  OutputOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

const CONFIG_FILENAME = "config.json";

interface SetPasswordResult {
  action: "password_set";
  configPath: string;
  restartCommand: string;
  message: string;
}

export type PromptPassword = (message: string) => Promise<string | symbol>;

export interface SetPasswordOptions {
  home?: string;
  promptPassword?: PromptPassword;
}

const setPasswordResultSchema: OutputSchema<SetPasswordResult> = {
  idField: "action",
  columns: [
    { header: "STATUS", field: "action", color: () => "green" },
    { header: "CONFIG", field: "configPath" },
    { header: "RESTART", field: "restartCommand" },
  ],
  renderHuman: (result, options: OutputOptions) => {
    const data = result.data as SetPasswordResult;
    const rows = [
      `Password written to ${data.configPath}`,
      "Restart the daemon for the change to take effect.",
      `Run: ${data.restartCommand}`,
    ];
    if (options.format === "table") {
      return rows.join("\n");
    }
    return data.message;
  },
};

function createCommandError(code: string, message: string, details?: string): CommandError {
  return { code, message, ...(details ? { details } : {}) };
}

function terminalPasswordPrompt(): PromptPassword {
  if (!process.stdin.isTTY) {
    throw createCommandError(
      "PASSWORD_TTY_REQUIRED",
      "clisbot daemon set-password needs a terminal to read the password",
      "Run it in an interactive terminal, or set CLISBOT_PASSWORD in the daemon's environment instead.",
    );
  }
  return (message) => passwordPrompt({ message });
}

async function promptForPassword(promptPassword: PromptPassword): Promise<string> {
  const first = await promptPassword("New daemon password");
  if (isCancel(first)) {
    throw createCommandError("PASSWORD_CANCELLED", "Password update cancelled");
  }
  if (typeof first !== "string" || first.length === 0) {
    throw createCommandError("PASSWORD_REQUIRED", "Password cannot be empty");
  }

  const second = await promptPassword("Confirm daemon password");
  if (isCancel(second)) {
    throw createCommandError("PASSWORD_CANCELLED", "Password update cancelled");
  }
  if (first !== second) {
    throw createCommandError("PASSWORD_MISMATCH", "Passwords do not match");
  }

  return first;
}

export async function setDaemonPasswordInConfig(
  newPassword: string,
  options: SetPasswordOptions = {},
): Promise<SetPasswordResult> {
  const clisbotHome = resolveClisbotHome({ CLISBOT_HOME: options.home });
  const configPath = path.join(clisbotHome, CONFIG_FILENAME);
  const persisted = readPersistedConfig(clisbotHome);
  const nextConfig: PersistedConfig = {
    ...persisted,
    daemon: {
      ...persisted.daemon,
      auth: {
        ...persisted.daemon?.auth,
        password: hashDaemonPassword(newPassword),
      },
    },
  };

  savePersistedConfig(clisbotHome, nextConfig);

  return {
    action: "password_set",
    configPath,
    restartCommand: `clisbot daemon restart --home ${JSON.stringify(clisbotHome)}`,
    message: `Password written to ${configPath}\nRestart the daemon for the change to take effect.\nRun: clisbot daemon restart --home ${JSON.stringify(clisbotHome)}`,
  };
}

export async function runSetPasswordCommand(
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<SetPasswordResult>> {
  const promptPassword =
    typeof options.promptPassword === "function"
      ? (options.promptPassword as PromptPassword)
      : terminalPasswordPrompt();
  const newPassword = await promptForPassword(promptPassword);
  const result = await setDaemonPasswordInConfig(newPassword, {
    home: options.daemonTarget.kind === "instance" ? options.daemonTarget.home : undefined,
  });

  return {
    type: "single",
    data: result,
    schema: setPasswordResultSchema,
  };
}
