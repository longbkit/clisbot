import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { ensureDir, expandHomePath, getDefaultConfigPath } from "../shared/paths.ts";
import { readTextFile, writeTextFile } from "../shared/fs.ts";
import { clisbotConfigSchema, type ClisbotConfig } from "./schema.ts";
import { normalizeConfigDirectMessageRoutes } from "./direct-message-routes.ts";
import { applyDynamicPathDefaults, assertNoLegacyPrivilegeCommands } from "./load-config.ts";
import { renderDefaultConfigTemplate } from "./template.ts";

export async function ensureEditableConfigFile(configPath = getDefaultConfigPath()) {
  const expandedConfigPath = expandHomePath(configPath);
  await ensureDir(dirname(expandedConfigPath));

  if (!existsSync(expandedConfigPath)) {
    await writeTextFile(expandedConfigPath, renderDefaultConfigTemplate());
  }

  return expandedConfigPath;
}

export type ConfigBootstrapOptions = {
  slackEnabled?: boolean;
  telegramEnabled?: boolean;
  slackAppTokenRef?: string;
  slackBotTokenRef?: string;
  telegramBotTokenRef?: string;
};

export async function readEditableConfig(configPath = getDefaultConfigPath()): Promise<{
  configPath: string;
  config: ClisbotConfig;
}> {
  const expandedConfigPath = await ensureEditableConfigFile(configPath);
  const text = await readTextFile(expandedConfigPath);
  const parsed = JSON.parse(text);
  assertNoLegacyPrivilegeCommands(parsed);
  return {
    configPath: expandedConfigPath,
    config: normalizeConfigDirectMessageRoutes(
      clisbotConfigSchema.parse(applyDynamicPathDefaults(parsed)),
    ),
  };
}

export async function writeEditableConfig(configPath: string, config: ClisbotConfig) {
  const expandedConfigPath = expandHomePath(configPath);
  await ensureDir(dirname(expandedConfigPath));
  const normalizedConfig = normalizeConfigDirectMessageRoutes(config);
  const nextConfig = {
    ...normalizedConfig,
    meta: {
      ...normalizedConfig.meta,
      lastTouchedAt: new Date().toISOString(),
    },
  };
  await writeTextFile(expandedConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
}
