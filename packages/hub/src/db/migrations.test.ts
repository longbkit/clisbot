import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("database migrations", () => {
  it("keeps hub_config_version_id columns compatible with hub_configs.id", () => {
    const machineModel = readFileSync(join(here, "migrations/0001_machine_model.sql"), "utf8");
    const hubConfigs = readFileSync(join(here, "migrations/0003_hub_configs.sql"), "utf8");

    assert.match(machineModel, /"machines"[\s\S]*"hub_config_version_id" uuid,/);
    assert.match(machineModel, /"agent_executions"[\s\S]*"hub_config_version_id" uuid NOT NULL/);
    assert.match(
      hubConfigs,
      /ALTER TABLE "machines" ALTER COLUMN "hub_config_version_id" TYPE uuid/,
    );
    assert.match(
      hubConfigs,
      /ALTER TABLE "agent_executions" ALTER COLUMN "hub_config_version_id" TYPE uuid/,
    );
  });

  it("adds nullable signature-hash dedup for new webhook rows", () => {
    const webhookDedup = readFileSync(
      join(here, "migrations/0004_webhook_signature_dedup.sql"),
      "utf8",
    );

    assert.match(webhookDedup, /ADD COLUMN "signature_hash" text/);
    assert.match(
      webhookDedup,
      /CREATE UNIQUE INDEX "triggers_signature_hash_unique"[\s\S]*\("signature_hash"\)[\s\S]*WHERE "signature_hash" IS NOT NULL/,
    );
  });

  it("adds agent execution completion callback state", () => {
    const completionCallback = readFileSync(
      join(here, "migrations/0006_agent_execution_completion_callback.sql"),
      "utf8",
    );

    assert.match(completionCallback, /ADD COLUMN "completion_token_hash" text/);
    assert.match(completionCallback, /ADD COLUMN "completed_by_agent_at" timestamp with time zone/);
  });

  it("backfills a deadline for pending agent executions", () => {
    const deadline = readFileSync(
      join(here, "migrations/0007_agent_execution_deadline.sql"),
      "utf8",
    );

    assert.match(deadline, /ADD COLUMN "deadline_at" timestamp with time zone/);
    assert.match(deadline, /"started_at" \+ interval '30 minutes'/);
  });

  it("removes the legacy registered-daemon persistence surface", () => {
    const cleanup = readFileSync(join(here, "migrations/0009_drop_legacy_daemons.sql"), "utf8");

    assert.match(cleanup, /DROP TABLE IF EXISTS "registered_daemons" CASCADE/);
  });

  it("destructively cuts superseded trigger and execution ownership paths", () => {
    const cutover = readFileSync(join(here, "../../drizzle/0018_silky_cannonball.sql"), "utf8");

    assert.match(cutover, /DROP TABLE "triggers" CASCADE/);
    assert.match(cutover, /DROP COLUMN "trigger_id"/);
    assert.match(cutover, /DROP COLUMN "trigger_connection_id"/);
    assert.match(cutover, /DROP COLUMN "trigger_resource_id"/);
    assert.match(cutover, /provider_event_receipt_id/);
    assert.match(cutover, /preserve|disposition/iu);
  });

  it("backfills app onboarding only for installations that already exist", () => {
    const migration = readFileSync(join(here, "../../drizzle/0035_smooth_wonder_man.sql"), "utf8");
    assert.match(migration, /UPDATE "instance_bootstrap"[\s\S]*app_onboarding_completed_at/u);
    assert.match(migration, /WHERE EXISTS \(SELECT 1 FROM "user"\)/u);
    assert.match(migration, /DELETE FROM "organization_connection_attempts"/u);
  });
});
