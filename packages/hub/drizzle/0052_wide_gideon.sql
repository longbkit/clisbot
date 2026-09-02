CREATE TABLE "channel_configuration_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"version" integer NOT NULL,
	"files" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_channel_configurations" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"active_revision_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_configuration_revisions" ADD CONSTRAINT "channel_configuration_revisions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_configuration_revisions" ADD CONSTRAINT "channel_configuration_revisions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_channel_configurations" ADD CONSTRAINT "organization_channel_configurations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_configuration_revisions_organization_version_unique" ON "channel_configuration_revisions" USING btree ("organization_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_configuration_revisions_id_organization_unique" ON "channel_configuration_revisions" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "organization_channel_configurations" ADD CONSTRAINT "organization_channel_configurations_revision_organization_fk" FOREIGN KEY ("active_revision_id","organization_id") REFERENCES "public"."channel_configuration_revisions"("id","organization_id") ON DELETE no action ON UPDATE no action;
