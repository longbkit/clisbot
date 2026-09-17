import { dirname, join } from "node:path";
import {
  expandHomePath,
  getDefaultConfigPath,
  getDefaultRuntimeCredentialsPath,
  getDefaultRuntimeLogPath,
  getDefaultRuntimeMonitorStatePath,
  getDefaultRuntimePidPath,
} from "../../infra/paths.ts";

export function resolveRuntimeConfigPath(configPath?: string) {
  return expandHomePath(
    configPath ?? process.env.CLISBOT_CONFIG_PATH ?? getDefaultConfigPath(),
  );
}

export function resolveRuntimePidPath(
  pidPath?: string,
  configPath?: string,
  options: { preferConfigSibling?: boolean } = {},
) {
  return resolveRuntimePath({
    explicitPath: pidPath,
    configPath,
    preferConfigSibling: options.preferConfigSibling,
    envPath: process.env.CLISBOT_PID_PATH,
    filename: "clisbot.pid",
    defaultPath: getDefaultRuntimePidPath(),
  });
}

export function resolveRuntimeLogPath(
  logPath?: string,
  configPath?: string,
  options: { preferConfigSibling?: boolean } = {},
) {
  return resolveRuntimePath({
    explicitPath: logPath,
    configPath,
    preferConfigSibling: options.preferConfigSibling,
    envPath: process.env.CLISBOT_LOG_PATH,
    filename: "clisbot.log",
    defaultPath: getDefaultRuntimeLogPath(),
  });
}

export function resolveRuntimeMonitorStatePath(
  monitorStatePath?: string,
  configPath?: string,
  options: { preferConfigSibling?: boolean } = {},
) {
  return resolveRuntimePath({
    explicitPath: monitorStatePath,
    configPath,
    preferConfigSibling: options.preferConfigSibling,
    envPath: process.env.CLISBOT_RUNTIME_MONITOR_STATE_PATH,
    filename: "clisbot-monitor.json",
    defaultPath: getDefaultRuntimeMonitorStatePath(),
  });
}

export function resolveRuntimeCredentialsPath(
  runtimeCredentialsPath?: string,
  configPath?: string,
  options: { preferConfigSibling?: boolean } = {},
) {
  return resolveRuntimePath({
    explicitPath: runtimeCredentialsPath,
    configPath,
    preferConfigSibling: options.preferConfigSibling,
    envPath: process.env.CLISBOT_RUNTIME_CREDENTIALS_PATH,
    filename: "runtime-credentials.json",
    defaultPath: getDefaultRuntimeCredentialsPath(),
  });
}

function resolveRuntimePath(params: {
  explicitPath?: string;
  configPath?: string;
  preferConfigSibling?: boolean;
  envPath?: string;
  filename: string;
  defaultPath: string;
}) {
  if (params.explicitPath) {
    return expandHomePath(params.explicitPath);
  }

  if (params.preferConfigSibling) {
    const siblingPath = deriveRuntimeSiblingPath(params.configPath, params.filename);
    if (siblingPath) {
      return siblingPath;
    }
  }

  if (params.envPath) {
    return expandHomePath(params.envPath);
  }

  const siblingPath = deriveRuntimeSiblingPath(
    params.configPath ?? process.env.CLISBOT_CONFIG_PATH,
    params.filename,
  );
  return siblingPath ?? expandHomePath(params.defaultPath);
}

function deriveRuntimeSiblingPath(
  configPath: string | undefined,
  filename: string,
) {
  if (!configPath) {
    return null;
  }
  return join(dirname(expandHomePath(configPath)), "state", filename);
}
