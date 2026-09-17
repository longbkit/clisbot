-- A Channel identity is verified once per identity realm (a Slack workspace, or
-- Telegram) instead of once per Connection. Backfill each row's realm from the
-- Connection it was verified through, drop rows whose Connection is gone, then
-- keep the most recently verified row of each (organization, realm, subject).
DROP INDEX "channel_identities_connection_subject_unique";--> statement-breakpoint
ALTER TABLE "channel_identities" ADD COLUMN "identity_realm" text;--> statement-breakpoint
UPDATE "channel_identities" AS "identity" SET "identity_realm" = 'slack:' || "connection"."team_id"
FROM "slack_connections" AS "connection"
WHERE "connection"."id"::text = "identity"."connection_id"
  AND "connection"."organization_id" = "identity"."organization_id";--> statement-breakpoint
UPDATE "channel_identities" AS "identity" SET "identity_realm" = 'telegram'
FROM "telegram_connections" AS "connection"
WHERE "identity"."identity_realm" IS NULL
  AND "connection"."id"::text = "identity"."connection_id"
  AND "connection"."organization_id" = "identity"."organization_id";--> statement-breakpoint
DELETE FROM "channel_identities" WHERE "identity_realm" IS NULL;--> statement-breakpoint
DELETE FROM "channel_identities" AS "identity"
USING (
  SELECT "id", row_number() OVER (
    PARTITION BY "organization_id", "identity_realm", "external_subject_id"
    ORDER BY "verified_at" DESC, "created_at" DESC, "id"
  ) AS "rank"
  FROM "channel_identities"
) AS "ranked"
WHERE "ranked"."id" = "identity"."id" AND "ranked"."rank" > 1;--> statement-breakpoint
ALTER TABLE "channel_identities" ALTER COLUMN "identity_realm" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_identities_realm_subject_unique" ON "channel_identities" USING btree ("organization_id","identity_realm","external_subject_id");
