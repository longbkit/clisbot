import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_CONFIG_PATH, ensureDir, expandHomePath } from "../shared/paths.ts";
import { muxbotConfigSchema, type MuxbotConfig } from "./schema.ts";
import { renderDefaultConfigTemplate } from "./template.ts";

export async function ensureEditableConfigFile(configPath = DEFAULT_CONFIG_PATH) {
  const expandedConfigPath = expandHomePath(configPath);
  await ensureDir(dirname(expandedConfigPath));

  if (!existsSync(expandedConfigPath)) {
    await Bun.write(
      expandedConfigPath,
      renderDefaultConfigTemplate(),
    );
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

export async function readEditableConfig(configPath = DEFAULT_CONFIG_PATH): Promise<{
  configPath: string;
  config: MuxbotConfig;
}> {
  const expandedConfigPath = await ensureEditableConfigFile(configPath);
  const text = await Bun.file(expandedConfigPath).text();
  const parsed = JSON.parse(text);
  return {
    configPath: expandedConfigPath,
    config: muxbotConfigSchema.parse(parsed),
  };
}

export async function writeEditableConfig(configPath: string, config: MuxbotConfig) {
  const expandedConfigPath = expandHomePath(configPath);
  await ensureDir(dirname(expandedConfigPath));
  const nextConfig = {
    ...config,
    meta: {
      ...config.meta,
      lastTouchedAt: new Date().toISOString(),
    },
  } satisfies MuxbotConfig;
  await Bun.write(expandedConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
}
