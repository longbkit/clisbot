-- Hard cutover from project-owned provider resources to organization-owned resources.
-- Existing identities and evidence are copied before the legacy assignment tables are removed.
CREATE TABLE "github_repositories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "connection_id" uuid NOT NULL,
  "repository_id" bigint NOT NULL,
  "full_name" text NOT NULL,
  "default_branch" text NOT NULL,
  "discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_trigger_routes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "project_id" uuid NOT NULL,
  "configuration_revision_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "connection_id" uuid NOT NULL,
  "resource_id" text,
  "trigger_name" text NOT NULL,
  CONSTRAINT "project_trigger_routes_provider_check" CHECK ("provider" in ('github', 'slack', 'discord'))
);
--> statement-breakpoint
CREATE TABLE "provider_event_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "provider" text NOT NULL,
  "connection_id" uuid,
  "resource_id" text,
  "delivery_id" text NOT NULL,
  "signature_hash" text,
  "source" text NOT NULL,
  "repo" text,
  "payload" jsonb NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "dropped_reason" text,
  CONSTRAINT "provider_event_receipts_provider_check" CHECK ("provider" in ('github', 'slack', 'discord', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_event_receipts_id_organization_unique"
  ON "provider_event_receipts" USING btree ("id", "organization_id");
--> statement-breakpoint

ALTER TABLE "github_connections" ADD COLUMN "slug" text;
ALTER TABLE "discord_connections" ADD COLUMN "slug" text;
ALTER TABLE "slack_connections" ADD COLUMN "slug" text;
--> statement-breakpoint
WITH normalized AS (
  SELECT
    "id",
    coalesce(
      nullif(trim(both '-' from regexp_replace(lower("account_login"), '[^a-z0-9]+', '-', 'g')), ''),
      'connection'
    ) AS identity
  FROM "github_connections"
), ranked AS (
  SELECT
    "id",
    identity || '-github' AS base,
    row_number() OVER (PARTITION BY identity ORDER BY "id") AS suffix
  FROM normalized
)
UPDATE "github_connections" AS connection
SET "slug" = CASE WHEN ranked.suffix = 1 THEN ranked.base ELSE ranked.base || '-' || ranked.suffix::text END
FROM ranked
WHERE connection."id" = ranked."id";
WITH normalized AS (
  SELECT
    "id",
    coalesce(
      nullif(trim(both '-' from regexp_replace(lower("guild_name"), '[^a-z0-9]+', '-', 'g')), ''),
      'connection'
    ) AS identity
  FROM "discord_connections"
), ranked AS (
  SELECT
    "id",
    identity || '-discord' AS base,
    row_number() OVER (PARTITION BY identity ORDER BY "id") AS suffix
  FROM normalized
)
UPDATE "discord_connections" AS connection
SET "slug" = CASE WHEN ranked.suffix = 1 THEN ranked.base ELSE ranked.base || '-' || ranked.suffix::text END
FROM ranked
WHERE connection."id" = ranked."id";
WITH normalized AS (
  SELECT
    "id",
    coalesce(
      nullif(trim(both '-' from regexp_replace(lower("team_name"), '[^a-z0-9]+', '-', 'g')), ''),
      'connection'
    ) AS identity
  FROM "slack_connections"
), ranked AS (
  SELECT
    "id",
    identity || '-slack' AS base,
    row_number() OVER (PARTITION BY identity ORDER BY "id") AS suffix
  FROM normalized
)
UPDATE "slack_connections" AS connection
SET "slug" = CASE WHEN ranked.suffix = 1 THEN ranked.base ELSE ranked.base || '-' || ranked.suffix::text END
FROM ranked
WHERE connection."id" = ranked."id";
ALTER TABLE "github_connections" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "discord_connections" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "slack_connections" ALTER COLUMN "slug" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "project_configuration_sources" DROP CONSTRAINT IF EXISTS "project_configuration_sources_authority_shape_check";
ALTER TABLE "configuration_sync_attempts" DROP CONSTRAINT IF EXISTS "configuration_sync_attempts_repository_assignment_id_project_github_repositories_id_fk";
ALTER TABLE "organization_connection_attempts" DROP CONSTRAINT IF EXISTS "organization_connection_attempts_project_organization_fk";
ALTER TABLE "project_configuration_sources" DROP CONSTRAINT IF EXISTS "project_configuration_sources_repository_project_organization_fk";
--> statement-breakpoint
ALTER TABLE "configuration_sync_attempts" ADD COLUMN "github_connection_id" uuid;
ALTER TABLE "configuration_sync_attempts" ADD COLUMN "github_repository_id" bigint;
ALTER TABLE "project_configuration_sources" ADD COLUMN "github_connection_id" uuid;
ALTER TABLE "project_configuration_sources" ADD COLUMN "github_repository_id" bigint;
ALTER TABLE "project_configuration_sources" ADD COLUMN "github_repository_full_name" text;
ALTER TABLE "project_configuration_sources" ADD COLUMN "github_default_branch" text;
--> statement-breakpoint

INSERT INTO "github_repositories" (
  "organization_id", "connection_id", "repository_id", "full_name", "default_branch"
)
SELECT DISTINCT ON (legacy."connection_id", legacy."repository_id")
  legacy."organization_id", legacy."connection_id", legacy."repository_id",
  legacy."full_name", legacy."default_branch"
FROM "project_github_repositories" legacy
ORDER BY legacy."connection_id", legacy."repository_id", legacy."assigned_at" DESC NULLS LAST, legacy."id";
--> statement-breakpoint

UPDATE "project_configuration_sources" source
SET "github_connection_id" = repository."connection_id",
    "github_repository_id" = repository."repository_id",
    "github_repository_full_name" = repository."full_name",
    "github_default_branch" = repository."default_branch"
FROM "project_github_repositories" repository
WHERE source."repository_assignment_id" = repository."id";
UPDATE "configuration_sync_attempts" attempt
SET "github_connection_id" = repository."connection_id",
    "github_repository_id" = repository."repository_id"
FROM "project_github_repositories" repository
WHERE attempt."repository_assignment_id" = repository."id";
--> statement-breakpoint

-- Recover organization ownership only from the project or execution graph. Any row
-- without one unambiguous owner is intentionally rejected below.
UPDATE "triggers" trigger
SET "organization_id" = project."organization_id"
FROM "projects" project
WHERE trigger."organization_id" IS NULL
  AND trigger."project_id" = project."id";
UPDATE "triggers" trigger
SET "organization_id" = ownership."organization_id"
FROM (
  SELECT execution."trigger_id", min(execution."organization_id") AS "organization_id"
  FROM "agent_executions" execution
  WHERE execution."trigger_id" IS NOT NULL
  GROUP BY execution."trigger_id"
  HAVING count(DISTINCT execution."organization_id") = 1
) ownership
WHERE trigger."organization_id" IS NULL
  AND ownership."trigger_id" = trigger."id";

-- Once the project and execution graphs have been exhausted, tenantless/projectless
-- trigger receipts with no execution reference are disposable pre-cutover evidence.
-- Every referenced or otherwise unresolved row remains a migration blocker.
DELETE FROM "triggers" trigger
WHERE trigger."organization_id" IS NULL
  AND trigger."project_id" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "agent_executions" execution
    WHERE execution."trigger_id" = trigger."id"
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "triggers" WHERE "organization_id" IS NULL) THEN
    RAISE EXCEPTION 'organization connection cutover found an ambiguous or unowned trigger';
  END IF;
END $$;
--> statement-breakpoint

-- Every pre-cutover durable trigger receives one organization-level receipt. The old
-- delivery-id uniqueness guarantees that this mapping is deterministic.
INSERT INTO "provider_event_receipts" (
  "organization_id", "provider", "connection_id", "resource_id", "delivery_id",
  "signature_hash", "source", "repo", "payload", "received_at", "dropped_reason"
)
SELECT trigger."organization_id",
       CASE
         WHEN split_part(trigger."source", '.', 1) in ('github', 'slack', 'discord')
           THEN split_part(trigger."source", '.', 1)
         ELSE 'manual'
       END,
       repository."connection_id",
       CASE WHEN repository."repository_id" IS NULL THEN NULL ELSE repository."repository_id"::text END,
       trigger."delivery_id", trigger."signature_hash", trigger."source", trigger."repo",
       trigger."payload", trigger."received_at", trigger."dropped_reason"
FROM "triggers" trigger
LEFT JOIN LATERAL (
  SELECT repository."connection_id", repository."repository_id"
  FROM "github_repositories" repository
  WHERE repository."organization_id" = trigger."organization_id"
    AND repository."full_name" = trigger."repo"
  ORDER BY repository."id"
  LIMIT 1
) repository ON true;
--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "receipt_id" uuid;
ALTER TABLE "triggers" ADD COLUMN "connection_id" uuid;
ALTER TABLE "triggers" ADD COLUMN "resource_id" text;
--> statement-breakpoint
UPDATE "triggers" trigger
SET "receipt_id" = receipt."id",
    "connection_id" = receipt."connection_id",
    "resource_id" = receipt."resource_id"
FROM "provider_event_receipts" receipt
WHERE receipt."delivery_id" = trigger."delivery_id";
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "triggers" WHERE "receipt_id" IS NULL) THEN
    RAISE EXCEPTION 'organization connection cutover could not preserve a trigger receipt';
  END IF;
END $$;
ALTER TABLE "triggers" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "triggers" ALTER COLUMN "receipt_id" SET NOT NULL;
--> statement-breakpoint

-- Compile the active configuration's authored provider resources into immutable routes.
-- A missing resource produces no route; the runtime activation compiler rejects that
-- condition for all newly authored revisions.
INSERT INTO "project_trigger_routes" (
  "organization_id", "project_id", "configuration_revision_id", "provider",
  "connection_id", "resource_id", "trigger_name"
)
SELECT project."organization_id", project."id", revision."id",
       split_part(item.trigger->>'on', '.', 1), connection."id",
       CASE
         WHEN split_part(item.trigger->>'on', '.', 1) = 'github' THEN repository."repository_id"::text
         WHEN split_part(item.trigger->>'on', '.', 1) = 'slack' THEN connection."team_id"
         WHEN split_part(item.trigger->>'on', '.', 1) = 'discord' THEN connection."guild_id"
         ELSE NULL
       END,
       item.trigger->>'name'
FROM "projects" project
JOIN "project_configuration_revisions" revision
  ON revision."id" = project."active_configuration_revision_id"
CROSS JOIN LATERAL jsonb_array_elements(revision."normalized_configuration"->'triggers') item(trigger)
JOIN LATERAL (
  SELECT split_part(item.trigger->>'on', '.', 1) AS provider,
         item.trigger->'filters'->>'repo' AS repo,
         item.trigger->'filters'->>'workspace' AS workspace,
         item.trigger->'filters'->>'guild' AS guild
) authored ON true
JOIN LATERAL (
  SELECT connection."id", connection."team_id", NULL::text AS "guild_id"
  FROM "slack_connections" connection
  WHERE authored.provider = 'slack'
    AND connection."organization_id" = project."organization_id"
    AND (authored.workspace IS NULL OR authored.workspace = connection."team_id")
  UNION ALL
  SELECT connection."id", NULL::text AS "team_id", connection."guild_id"
  FROM "discord_connections" connection
  WHERE authored.provider = 'discord'
    AND connection."organization_id" = project."organization_id"
    AND (authored.guild IS NULL OR authored.guild = connection."guild_id")
  UNION ALL
  SELECT connection."id", NULL::text AS "team_id", NULL::text AS "guild_id"
  FROM "github_connections" connection
  WHERE authored.provider = 'github'
    AND connection."organization_id" = project."organization_id"
    AND (authored.repo IS NULL OR EXISTS (
      SELECT 1 FROM "github_repositories" repository
      WHERE repository."connection_id" = connection."id"
        AND repository."full_name" = authored.repo
    ))
) connection ON true
LEFT JOIN "github_repositories" repository
  ON authored.provider = 'github' AND repository."connection_id" = connection."id"
 AND repository."organization_id" = project."organization_id"
 AND authored.repo IS NOT NULL AND repository."full_name" = authored.repo;
--> statement-breakpoint

ALTER TABLE "agent_executions" ADD COLUMN "trigger_connection_id" uuid;
ALTER TABLE "agent_executions" ADD COLUMN "trigger_resource_id" text;
UPDATE "agent_executions" execution
SET "trigger_connection_id" = trigger."connection_id",
    "trigger_resource_id" = trigger."resource_id"
FROM "triggers" trigger
WHERE execution."trigger_id" = trigger."id";
--> statement-breakpoint

DROP INDEX IF EXISTS "triggers_delivery_id_unique";
ALTER TABLE "triggers" DROP CONSTRAINT IF EXISTS "triggers_organization_or_dropped_check";
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_receipt_organization_fk"
  FOREIGN KEY ("receipt_id", "organization_id")
  REFERENCES "provider_event_receipts" ("id", "organization_id");
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_receipt_project_unique"
  UNIQUE ("receipt_id", "project_id");
--> statement-breakpoint

ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_connection_organization_fk"
  FOREIGN KEY ("connection_id", "organization_id")
  REFERENCES "github_connections" ("id", "organization_id") ON DELETE CASCADE;
ALTER TABLE "provider_event_receipts" ADD CONSTRAINT "provider_event_receipts_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") ON DELETE CASCADE;
ALTER TABLE "project_trigger_routes" ADD CONSTRAINT "project_trigger_routes_project_organization_fk"
  FOREIGN KEY ("project_id", "organization_id")
  REFERENCES "projects" ("id", "organization_id") ON DELETE CASCADE;
ALTER TABLE "project_trigger_routes" ADD CONSTRAINT "project_trigger_routes_revision_project_organization_fk"
  FOREIGN KEY ("configuration_revision_id", "project_id", "organization_id")
  REFERENCES "project_configuration_revisions" ("id", "project_id", "organization_id") ON DELETE CASCADE;
ALTER TABLE "configuration_sync_attempts" ADD CONSTRAINT "configuration_sync_attempts_github_connection_organization_fk"
  FOREIGN KEY ("github_connection_id", "organization_id")
  REFERENCES "github_connections" ("id", "organization_id") ON DELETE SET NULL;
ALTER TABLE "project_configuration_sources" ADD CONSTRAINT "project_configuration_sources_github_connection_organization_fk"
  FOREIGN KEY ("github_connection_id", "organization_id")
  REFERENCES "github_connections" ("id", "organization_id") ON DELETE RESTRICT;
--> statement-breakpoint

CREATE UNIQUE INDEX "github_repositories_connection_repository_unique"
  ON "github_repositories" ("connection_id", "repository_id");
CREATE INDEX "github_repositories_organization_idx" ON "github_repositories" ("organization_id");
CREATE UNIQUE INDEX "project_trigger_routes_shape_unique"
  ON "project_trigger_routes" ("project_id", "configuration_revision_id", "provider", "connection_id", "resource_id", "trigger_name");
CREATE INDEX "project_trigger_routes_resource_idx"
  ON "project_trigger_routes" ("organization_id", "provider", "connection_id", "resource_id");
CREATE UNIQUE INDEX "provider_event_receipts_delivery_unique" ON "provider_event_receipts" ("delivery_id");
CREATE UNIQUE INDEX "provider_event_receipts_signature_unique"
  ON "provider_event_receipts" ("signature_hash") WHERE "signature_hash" IS NOT NULL;
CREATE INDEX "provider_event_receipts_organization_received_idx"
  ON "provider_event_receipts" ("organization_id", "received_at" DESC NULLS LAST);
CREATE INDEX "provider_event_receipts_resource_idx"
  ON "provider_event_receipts" ("organization_id", "provider", "connection_id", "resource_id");
CREATE UNIQUE INDEX "github_connections_organization_slug_unique"
  ON "github_connections" ("organization_id", "slug");
CREATE UNIQUE INDEX "discord_connections_organization_slug_unique"
  ON "discord_connections" ("organization_id", "slug");
CREATE UNIQUE INDEX "slack_connections_organization_slug_unique"
  ON "slack_connections" ("organization_id", "slug");
--> statement-breakpoint

ALTER TABLE "project_configuration_sources" DROP COLUMN "repository_assignment_id";
ALTER TABLE "configuration_sync_attempts" DROP COLUMN "repository_assignment_id";
ALTER TABLE "organization_connection_attempts" DROP COLUMN IF EXISTS "target_project_id";
--> statement-breakpoint
ALTER TABLE "project_configuration_sources" ADD CONSTRAINT "project_configuration_sources_authority_shape_check"
  CHECK (("kind" = 'manual' AND "github_connection_id" IS NULL AND "github_repository_id" IS NULL AND NOT "automatic_deployment_enabled")
      OR ("kind" = 'github' AND "github_connection_id" IS NOT NULL AND "github_repository_id" IS NOT NULL));
--> statement-breakpoint

DROP TABLE "project_daemons" CASCADE;
DROP TABLE "project_discord_connections" CASCADE;
DROP TABLE "project_github_connections" CASCADE;
DROP TABLE "project_github_repositories" CASCADE;
DROP TABLE "project_slack_connections" CASCADE;
