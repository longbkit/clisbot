import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { ensureDir, expandHomePath, getDefaultConfigPath } from "../shared/paths.ts";
import { readTextFile, writeTextFile } from "../shared/fs.ts";
import { clisbotConfigSchema, type ClisbotConfig } from "./schema.ts";
import { applyDynamicPathDefaults, assertNoLegacyPrivilegeCommands } from "./config-document.ts";
import { normalizeConfigDocumentShape } from "./config-migration.ts";
import { upgradeEditableConfigFileIfNeeded } from "./config-upgrade.ts";
import { normalizeConfigDirectMessageRoutes } from "./direct-message-routes.ts";
import { normalizeConfigGroupRoutes } from "./group-routes.ts";
import { pruneConfigForPersistence } from "./persisted-config.ts";
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
  await upgradeEditableConfigFileIfNeeded(expandedConfigPath);
  const text = await readTextFile(expandedConfigPath);
  const parsed = normalizeConfigDocumentShape(JSON.parse(text));
  assertNoLegacyPrivilegeCommands(parsed);
  return {
    configPath: expandedConfigPath,
    config: normalizeConfigGroupRoutes(
      normalizeConfigDirectMessageRoutes(
        clisbotConfigSchema.parse(applyDynamicPathDefaults(parsed)),
        {
          exactAdmissionMode: "explicit",
        },
      ),
    ),
  };
}

export async function writeEditableConfig(configPath: string, config: ClisbotConfig) {
  const expandedConfigPath = expandHomePath(configPath);
  await ensureDir(dirname(expandedConfigPath));
  const normalizedConfig = normalizeConfigGroupRoutes(
    normalizeConfigDirectMessageRoutes(config, {
      exactAdmissionMode: "explicit",
    }),
  );
  const nextConfig = {
    ...pruneConfigForPersistence(normalizedConfig),
    meta: {
      ...normalizedConfig.meta,
      lastTouchedAt: new Date().toISOString(),
    },
  };
  await writeTextFile(expandedConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
}
