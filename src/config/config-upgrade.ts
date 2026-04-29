import { basename, dirname, join } from "node:path";
import { ensureDir, fileExists, readTextFile, writeTextFile } from "../shared/fs.ts";
import { collapseHomePath, expandHomePath } from "../shared/paths.ts";
import { applyDynamicPathDefaults, assertNoLegacyPrivilegeCommands } from "./config-document.ts";
import {
  CURRENT_SCHEMA_VERSION,
  normalizeConfigDocumentShape,
  shouldUpgradeConfigSchema,
} from "./config-migration.ts";
import { normalizeConfigDirectMessageRoutes } from "./direct-message-routes.ts";
import { normalizeConfigGroupRoutes } from "./group-routes.ts";
import { pruneConfigForPersistence } from "./persisted-config.ts";
import { clisbotConfigSchema } from "./schema.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return true;
}

function readSchemaVersion(value: unknown) {
  if (!isRecord(value) || !isRecord(value.meta)) {
    return undefined;
  }
  const schemaVersion = value.meta.schemaVersion;
  return typeof schemaVersion === "string" ? schemaVersion.trim() : undefined;
}

function readMetaRecord(value: unknown) {
  return isRecord(value) && isRecord(value.meta) ? value.meta : {};
}

function logUpgradeStage(message: string) {
  console.warn(`clisbot config upgrade: ${message}`);
}

function stableConfigText(config: unknown) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function pruneCurrentSchemaStartupDefaults(config: unknown) {
  const nextConfig = structuredClone(config) as Record<string, unknown>;
  const meta = readMetaRecord(nextConfig);
  if (readSchemaVersion(nextConfig) !== CURRENT_SCHEMA_VERSION) {
    return nextConfig;
  }
  const agents = isRecord(nextConfig.agents) ? nextConfig.agents : undefined;
  const defaults = isRecord(agents?.defaults) ? agents.defaults : undefined;
  const runner = isRecord(defaults?.runner) ? defaults.runner : undefined;
  const runnerDefaults = isRecord(runner?.defaults) ? runner.defaults : undefined;
  if (runnerDefaults?.startupDelayMs === 3000) {
    delete runnerDefaults.startupDelayMs;
    nextConfig.meta = {
      ...meta,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      lastTouchedAt: new Date().toISOString(),
    };
  }
  return nextConfig;
}

function renderBackupTimestamp(date = new Date()) {
  return date.toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function reserveBackupPath(configPath: string, schemaVersion: string | undefined) {
  const backupDir = join(dirname(configPath), "backups");
  await ensureDir(backupDir);
  const versionLabel = (schemaVersion || "unknown").replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  const baseName = `${basename(configPath)}.${versionLabel}.${renderBackupTimestamp()}`;
  let candidate = join(backupDir, baseName);
  let suffix = 1;
  while (await fileExists(candidate)) {
    candidate = join(backupDir, `${baseName}.${suffix}`);
    suffix += 1;
  }
  return candidate;
}

export async function upgradeEditableConfigFileIfNeeded(configPath: string) {
  const expandedConfigPath = expandHomePath(configPath);
  const originalText = await readTextFile(expandedConfigPath);
  const rawConfig = JSON.parse(originalText);
  const fromVersion = readSchemaVersion(rawConfig);

  if (!shouldUpgradeConfigSchema(fromVersion)) {
    const persistedConfig = pruneCurrentSchemaStartupDefaults(rawConfig);
    if (stableConfigText(persistedConfig) !== stableConfigText(rawConfig)) {
      const backupPath = await reserveBackupPath(expandedConfigPath, fromVersion);
      await writeTextFile(
        backupPath,
        originalText.endsWith("\n") ? originalText : `${originalText}\n`,
      );
      const normalizedDocument = normalizeConfigDocumentShape(persistedConfig);
      assertNoLegacyPrivilegeCommands(normalizedDocument);
      clisbotConfigSchema.parse(applyDynamicPathDefaults(normalizedDocument));
      await writeTextFile(expandedConfigPath, stableConfigText(persistedConfig));
      return {
        upgraded: false as const,
        pruned: true as const,
        backupPath,
        schemaVersion: fromVersion || CURRENT_SCHEMA_VERSION,
      };
    }
    return { upgraded: false as const };
  }

  const versionLabel = fromVersion || "legacy";
  const backupPath = await reserveBackupPath(expandedConfigPath, fromVersion);
  await writeTextFile(backupPath, originalText.endsWith("\n") ? originalText : `${originalText}\n`);
  logUpgradeStage(
    `backup ${versionLabel} config to ${collapseHomePath(backupPath)}`,
  );
  logUpgradeStage(`preparing ${versionLabel} -> ${CURRENT_SCHEMA_VERSION}`);

  const normalizedDocument = normalizeConfigDocumentShape(rawConfig);
  assertNoLegacyPrivilegeCommands(normalizedDocument);
  logUpgradeStage(`dry-run validating ${CURRENT_SCHEMA_VERSION} config`);
  const normalizedConfig = normalizeConfigGroupRoutes(
    normalizeConfigDirectMessageRoutes(
      clisbotConfigSchema.parse(applyDynamicPathDefaults(normalizedDocument)),
      {
        exactAdmissionMode: "explicit",
      },
    ),
  );
  logUpgradeStage(`applying ${CURRENT_SCHEMA_VERSION} config to ${collapseHomePath(expandedConfigPath)}`);
  const persistedConfig = pruneConfigForPersistence(normalizedConfig, {
    forceRunnerStartupDefaults: true,
  });
  await writeTextFile(
    expandedConfigPath,
    stableConfigText({
      ...persistedConfig,
      meta: {
        ...normalizedConfig.meta,
        lastTouchedAt: new Date().toISOString(),
      },
    }),
  );

  logUpgradeStage(
    `applied ${versionLabel} -> ${CURRENT_SCHEMA_VERSION}; backup: ${collapseHomePath(backupPath)}`,
  );
  return {
    upgraded: true as const,
    backupPath,
    fromVersion: versionLabel,
    toVersion: CURRENT_SCHEMA_VERSION,
  };
}
