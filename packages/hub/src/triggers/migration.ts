import { createHash } from "node:crypto";
import { revisionBundleFiles } from "../configuration/store.js";
import type { Database, MigrateProjectTriggerInput } from "../db/types.js";
import { migrateLegacyBundle } from "./configuration/index.js";

export interface ProjectTriggerMigrationResult {
  projects: number;
  triggers: number;
  legacyMultistepTriggers: number;
}

/**
 * Explodes every active project revision into organization-owned triggers before providers start.
 * The database owns the atomic/idempotent write; this module owns semantic conversion.
 */
export async function migrateLegacyProjectTriggers(
  database: Database,
): Promise<ProjectTriggerMigrationResult> {
  const pending = await database.listPendingProjectTriggerMigrations();
  let projectCount = 0;
  let triggerCount = 0;
  let legacyMultistepTriggers = 0;
  for (const { project, revision } of pending) {
    await database.withAdvisoryLock(`project-trigger-migration:${project.id}`, async () => {
      const files = revisionBundleFiles(revision);
      if (files.length === 0) {
        throw new Error(
          `cannot migrate project ${project.slug}: active revision ${revision.id} has no authored bundle`,
        );
      }
      const migrated = migrateLegacyBundle({
        files,
        normalizedConfiguration: revision.normalizedConfiguration,
      });
      const triggers = migrated.map((trigger): MigrateProjectTriggerInput => {
        const normalizedConfiguration =
          trigger.format === "single_run"
            ? {
                environments: [trigger.compiled.environment],
                triggers: trigger.compiled.events,
              }
            : {
                environments: trigger.normalized.environments,
                triggers: [trigger.normalized.trigger],
              };
        return {
          name: trigger.name,
          format: trigger.format,
          enabled: true,
          yaml: trigger.yaml,
          normalizedConfiguration,
          contentHash: createHash("sha256").update(trigger.yaml).digest("hex"),
          sourceEvidence: {
            kind: "project_migration",
            legacyProjectId: project.id,
            legacyProjectSlug: project.slug,
            legacyConfigurationRevisionId: revision.id,
            legacyConfigurationVersion: revision.version,
            legacySourceKind: revision.sourceKind,
            legacySourceFile: trigger.legacySourceFile,
            legacyStepIds: trigger.legacyStepIds,
            ...(trigger.format === "legacy_multistep"
              ? {
                  conversionBlockers: trigger.conversionBlockers,
                  authoredYaml: trigger.authoredYaml,
                }
              : {}),
          },
        };
      });
      const created = await database.migrateProjectTriggers({
        projectId: project.id,
        organizationId: project.organizationId,
        configurationRevisionId: revision.id,
        projectSlug: project.slug,
        triggers,
      });
      triggerCount += created.length;
      if (created.length > 0) projectCount += 1;
      legacyMultistepTriggers += created.filter(
        ({ format }) => format === "legacy_multistep",
      ).length;
    });
  }
  return {
    projects: projectCount,
    triggers: triggerCount,
    legacyMultistepTriggers,
  };
}
