CREATE TABLE "runtime_provider_configuration" (
	"provider" text PRIMARY KEY NOT NULL,
	"configuration" jsonb NOT NULL,
	"verified_external_identity" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" text,
	CONSTRAINT "runtime_provider_configuration_provider_check" CHECK ("runtime_provider_configuration"."provider" in ('github', 'slack', 'discord')),
	CONSTRAINT "runtime_provider_configuration_version_check" CHECK ("runtime_provider_configuration"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "instance_bootstrap" ADD COLUMN "app_onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "instance_bootstrap"
SET "app_onboarding_completed_at" = now()
WHERE "app_onboarding_completed_at" IS NULL;--> statement-breakpoint
INSERT INTO "instance_bootstrap" ("id", "app_onboarding_completed_at")
SELECT 'default', now()
WHERE EXISTS (SELECT 1 FROM "user")
  AND NOT EXISTS (SELECT 1 FROM "instance_bootstrap" WHERE "id" = 'default');--> statement-breakpoint
DELETE FROM "organization_connection_attempts";--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD COLUMN "configuration_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD COLUMN "callback_origin" text NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD COLUMN "configuration_snapshot" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD COLUMN "expected_configuration_version" integer;--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD COLUMN "activate_configuration" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_provider_configuration" ADD CONSTRAINT "runtime_provider_configuration_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
