DO $$ BEGIN
  CREATE TYPE "public"."machine_status" AS ENUM('spawning', 'alive', 'terminated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."agent_execution_status" AS ENUM('spawning', 'running', 'succeeded', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "triggers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delivery_id" text NOT NULL,
  "signature_hash" text,
  "source" text NOT NULL,
  "repo" text,
  "payload" jsonb NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "matched_trigger_name" text,
  "dropped_reason" text
);
--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN IF NOT EXISTS "signature_hash" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "version" integer NOT NULL,
  "source" jsonb NOT NULL,
  "config" jsonb NOT NULL,
  "errors" jsonb,
  "is_current" boolean DEFAULT false NOT NULL,
  "rollback_target_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hub_configs" ADD COLUMN IF NOT EXISTS "rollback_target_id" uuid;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "machines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "source" jsonb NOT NULL,
  "status" "machine_status" NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "terminated_at" timestamp with time zone,
  "shutdown_reason" text,
  "hub_config_version_id" uuid REFERENCES "hub_configs"("id"),
  "trigger_name" text,
  "trigger_context" jsonb,
  "specs" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daemon_enrollment_tokens" (
  "id" uuid PRIMARY KEY NOT NULL,
  "verifier" text NOT NULL UNIQUE,
  "organization_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" ADD COLUMN IF NOT EXISTS "organization_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daemons" (
  "id" uuid PRIMARY KEY NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE,
  "enrollment_verifier" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "machine_id" uuid NOT NULL REFERENCES "machines"("id"),
  "server_id" text NOT NULL,
  "daemon_public_key" text NOT NULL,
  "credential_verifier" text NOT NULL,
  "scopes" jsonb NOT NULL,
  "status" text NOT NULL,
  "presence" text DEFAULT 'offline' NOT NULL,
  "connected_at" timestamp with time zone,
  "disconnected_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "machine_id" uuid NOT NULL REFERENCES "machines"("id"),
  "status" "agent_execution_status" NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "completed_by_agent_at" timestamp with time zone,
  "deadline_at" timestamp with time zone,
  "result" jsonb,
  "trigger_context" jsonb,
  "output_context" jsonb,
  "hub_config_version_id" uuid NOT NULL REFERENCES "hub_configs"("id"),
  "completion_token_hash" text,
  "launch_intent" jsonb,
  "daemon_id" uuid REFERENCES "daemons"("id"),
  "daemon_agent_id" text,
  "trigger_id" uuid
);
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN IF NOT EXISTS "completed_by_agent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN IF NOT EXISTS "deadline_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "agent_executions"
SET "deadline_at" = "started_at" + interval '30 minutes'
WHERE "status" IN ('spawning', 'running') AND "deadline_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN IF NOT EXISTS "completion_token_hash" text;
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN IF NOT EXISTS "launch_intent" jsonb;
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN IF NOT EXISTS "daemon_id" uuid REFERENCES "daemons"("id");
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN IF NOT EXISTS "daemon_agent_id" text;
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN IF NOT EXISTS "trigger_id" uuid;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "email_verified" boolean DEFAULT false NOT NULL,
  "image" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "logo" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "metadata" text
);
--> statement-breakpoint
INSERT INTO "organization" ("id", "name", "slug")
SELECT legacy_org."org_id", legacy_org."org_id", legacy_org."org_id"
FROM (
  SELECT "org_id" FROM "machines"
  UNION
  SELECT "org_id" FROM "hub_configs"
) AS legacy_org
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "token" text NOT NULL UNIQUE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "active_organization_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp with time zone,
  "refresh_token_expires_at" timestamp with time zone,
  "scope" text,
  "password" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitation" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" text,
  "status" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "inviter_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "operator_principals" (
  "principal_id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
DECLARE
  legacy_organization_id text;
  legacy_organization_count integer;
BEGIN
  IF EXISTS (SELECT 1 FROM "daemon_enrollment_tokens" WHERE "organization_id" IS NULL) THEN
    SELECT count(*), min("id") INTO legacy_organization_count, legacy_organization_id
    FROM "organization";
    IF legacy_organization_count = 0 THEN
      legacy_organization_id := 'org_1';
      INSERT INTO "organization" ("id", "name", "slug")
      VALUES (legacy_organization_id, 'Paseo', 'paseo');
    ELSIF legacy_organization_count <> 1 THEN
      RAISE EXCEPTION 'legacy enrollment-token organization is ambiguous';
    END IF;
    UPDATE "daemon_enrollment_tokens"
    SET "organization_id" = legacy_organization_id
    WHERE "organization_id" IS NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "triggers_delivery_id_unique" ON "triggers" ("delivery_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "triggers_signature_hash_unique" ON "triggers" ("signature_hash") WHERE "signature_hash" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "triggers_received_at_idx" ON "triggers" ("received_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hub_configs_org_name_version_idx" ON "hub_configs" ("org_id", "name", "version");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hub_configs_current_idx" ON "hub_configs" ("org_id", "name") WHERE "is_current";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machines_org_id_idx" ON "machines" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "machines_status_idx" ON "machines" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "daemons_machine_id_unique" ON "daemons" ("machine_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_executions_machine_id_idx" ON "agent_executions" ("machine_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_executions_status_idx" ON "agent_executions" ("status");
--> statement-breakpoint
DROP TABLE IF EXISTS "registered_daemons" CASCADE;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "paseo_hub_migrations" (
  "filename" text PRIMARY KEY,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "paseo_hub_migrations" ("filename") VALUES
  ('0000_calm_songbird.sql'),
  ('0001_machine_model.sql'),
  ('0003_hub_configs.sql'),
  ('0004_webhook_signature_dedup.sql'),
  ('0006_agent_execution_completion_callback.sql'),
  ('0007_agent_execution_deadline.sql'),
  ('0008_daemons.sql'),
  ('0009_drop_legacy_daemons.sql')
ON CONFLICT ("filename") DO NOTHING;
