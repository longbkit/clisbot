CREATE TABLE "entitlement_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"actor" text,
	"source" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_changes_source_check" CHECK ("entitlement_changes"."source" in ('provisioning', 'plan_stamp'))
);
--> statement-breakpoint
CREATE TABLE "organization_entitlements" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"granted" jsonb NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan_id" text,
	"plan_version" text,
	"stamped_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entitlement_changes" ADD CONSTRAINT "entitlement_changes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_entitlements" ADD CONSTRAINT "organization_entitlements_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlement_changes_organization_created_idx" ON "entitlement_changes" USING btree ("organization_id","created_at" DESC NULLS LAST);