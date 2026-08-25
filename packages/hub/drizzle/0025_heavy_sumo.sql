ALTER TABLE "entitlement_changes" DROP CONSTRAINT "entitlement_changes_source_check";--> statement-breakpoint
ALTER TABLE "entitlement_changes" ADD CONSTRAINT "entitlement_changes_source_check" CHECK ("entitlement_changes"."source" in ('provisioning', 'plan_stamp', 'override'));--> statement-breakpoint
-- Backfill: organizations created before entitlements existed have no row, so
-- EntitlementsService.read() throws once enforcement reads it on every member invite. An
-- org that predates entitlements was unlimited, so stamp the unlimited template and write
-- the provisioning audit row the original table creation never produced. The plan_version
-- is sha256(JSON.stringify(UNLIMITED_TEMPLATE)) — the same value hashTemplate() computes.
WITH backfilled AS (
  INSERT INTO "organization_entitlements"
    ("organization_id", "granted", "overrides", "plan_id", "plan_version", "stamped_at", "updated_at")
  SELECT "organization"."id",
         '{"seats":{"max":null},"canInviteMembers":true}'::jsonb,
         '{}'::jsonb,
         NULL,
         '2753dc123b7b4fd0d9ac36dbc00f6e676737fbf6fdcc19e2b79ff930dab6f51d',
         now(),
         now()
  FROM "organization"
  WHERE NOT EXISTS (
    SELECT 1 FROM "organization_entitlements"
    WHERE "organization_entitlements"."organization_id" = "organization"."id"
  )
  RETURNING "organization_id"
)
INSERT INTO "entitlement_changes"
  ("organization_id", "actor", "source", "before", "after", "reason")
SELECT "backfilled"."organization_id",
       NULL,
       'provisioning',
       NULL,
       '{"granted":{"seats":{"max":null},"canInviteMembers":true},"overrides":{}}'::jsonb,
       'Backfilled unlimited entitlements for an organization created before entitlements existed.'
FROM "backfilled";