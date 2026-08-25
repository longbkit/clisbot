CREATE TABLE "instance_bootstrap" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"owner_user_id" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_bootstrap_completion_check" CHECK ("instance_bootstrap"."completed_at" is null or ("instance_bootstrap"."organization_id" is not null and "instance_bootstrap"."owner_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "organization_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"verifier" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "organization_api_keys_scopes_check" CHECK ("organization_api_keys"."scopes" <@ ARRAY['configuration:install', 'runs:dispatch', 'daemons:enroll']::text[] and cardinality("organization_api_keys"."scopes") > 0)
);
--> statement-breakpoint
ALTER TABLE "operator_principals" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
DECLARE
	legacy_organization_id text;
BEGIN
	IF (SELECT count(DISTINCT organization_id) FROM "operator_principals") > 1 THEN
		RAISE EXCEPTION 'operator principals bind more than one organization; resolve ownership before upgrading';
	END IF;
	SELECT min(organization_id) INTO legacy_organization_id FROM "operator_principals";
	IF legacy_organization_id IS NOT NULL THEN
		INSERT INTO "instance_bootstrap" (id, organization_id)
		VALUES ('default', legacy_organization_id);
	END IF;
END $$;--> statement-breakpoint
DROP TABLE "operator_principals" CASCADE;--> statement-breakpoint
DROP INDEX "provider_event_receipts_delivery_unique";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_bootstrap" ADD CONSTRAINT "instance_bootstrap_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_bootstrap" ADD CONSTRAINT "instance_bootstrap_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_api_keys" ADD CONSTRAINT "organization_api_keys_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_api_keys" ADD CONSTRAINT "organization_api_keys_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_api_keys_prefix_unique" ON "organization_api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "organization_api_keys_organization_created_idx" ON "organization_api_keys" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "provider_event_receipts_organization_delivery_unique" ON "provider_event_receipts" USING btree ("organization_id","delivery_id");
