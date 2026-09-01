CREATE TABLE "organization_trigger_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"version" integer NOT NULL,
	"yaml" text NOT NULL,
	"normalized_configuration" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_evidence" jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_trigger_revisions_source_kind_check" CHECK ("organization_trigger_revisions"."source_kind" in ('manual', 'github', 'project_migration'))
);
--> statement-breakpoint
CREATE TABLE "organization_trigger_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"trigger_id" uuid NOT NULL,
	"trigger_revision_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"resource_id" text,
	"configured_event_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"format" text NOT NULL,
	"active_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_triggers_format_check" CHECK ("organization_triggers"."format" in ('single_run', 'legacy_multistep'))
);
--> statement-breakpoint
CREATE TABLE "project_trigger_migrations" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"configuration_revision_id" uuid NOT NULL,
	"migrated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_triggers_id_organization_unique" ON "organization_triggers" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_trigger_revisions_id_trigger_organization_unique" ON "organization_trigger_revisions" USING btree ("id","trigger_id","organization_id");--> statement-breakpoint
ALTER TABLE "organization_trigger_revisions" ADD CONSTRAINT "organization_trigger_revisions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_trigger_revisions" ADD CONSTRAINT "organization_trigger_revisions_trigger_organization_fk" FOREIGN KEY ("trigger_id","organization_id") REFERENCES "public"."organization_triggers"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_trigger_routes" ADD CONSTRAINT "organization_trigger_routes_trigger_organization_fk" FOREIGN KEY ("trigger_id","organization_id") REFERENCES "public"."organization_triggers"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_trigger_routes" ADD CONSTRAINT "organization_trigger_routes_revision_trigger_organization_fk" FOREIGN KEY ("trigger_revision_id","trigger_id","organization_id") REFERENCES "public"."organization_trigger_revisions"("id","trigger_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_triggers" ADD CONSTRAINT "organization_triggers_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_triggers" ADD CONSTRAINT "organization_triggers_active_revision_id_organization_trigger_revisions_id_fk" FOREIGN KEY ("active_revision_id") REFERENCES "public"."organization_trigger_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_trigger_migrations" ADD CONSTRAINT "project_trigger_migrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_trigger_migrations" ADD CONSTRAINT "project_trigger_migrations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_trigger_revisions_trigger_version_unique" ON "organization_trigger_revisions" USING btree ("trigger_id","version");--> statement-breakpoint
CREATE INDEX "organization_trigger_revisions_trigger_created_idx" ON "organization_trigger_revisions" USING btree ("trigger_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "organization_trigger_routes_shape_unique" ON "organization_trigger_routes" USING btree ("trigger_id","trigger_revision_id","provider","connection_id","resource_id","configured_event_name");--> statement-breakpoint
CREATE INDEX "organization_trigger_routes_resource_idx" ON "organization_trigger_routes" USING btree ("organization_id","provider","connection_id","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_triggers_organization_name_unique" ON "organization_triggers" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "organization_triggers_organization_updated_idx" ON "organization_triggers" USING btree ("organization_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "project_trigger_migrations_organization_idx" ON "project_trigger_migrations" USING btree ("organization_id");
