import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { ensureDir, expandHomePath, getDefaultConfigPath } from "../../infra/paths.ts";
import { readTextFile, writeTextFile } from "../../infra/fs.ts";
import { clisbotConfigSchema, type ClisbotConfig } from "./schema.ts";
import { applyDynamicPathDefaults, assertNoLegacyPrivilegeCommands } from "./config-document.ts";
import { normalizeConfigDocumentShape } from "./config-migration.ts";
import { upgradeEditableConfigFileIfNeeded } from "./config-upgrade.ts";
import { normalizeConfigDirectMessageRoutes } from "../channels/direct-message-routes.ts";
import { normalizeConfigGroupRoutes } from "../channels/group-routes.ts";
import { pruneConfigForPersistence } from "./persisted-config.ts";
import {
  renderDefaultConfigTemplate,
  type DefaultConfigTemplateOptions,
} from "./template.ts";

export async function ensureEditableConfigFile(configPath = getDefaultConfigPath()) {
  const expandedConfigPath = expandHomePath(configPath);
  await ensureDir(dirname(expandedConfigPath));

  if (!existsSync(expandedConfigPath)) {
    await writeTextFile(expandedConfigPath, renderDefaultConfigTemplate());
  }

  return expandedConfigPath;
}

export type ConfigBootstrapOptions = DefaultConfigTemplateOptions;

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
