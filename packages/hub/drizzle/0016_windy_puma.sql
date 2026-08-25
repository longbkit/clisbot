CREATE TABLE "attachment_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"source_id" text NOT NULL,
	"locator" jsonb NOT NULL,
	"filename" text NOT NULL,
	"content_type" text,
	"byte_size" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_capabilities_provider_check" CHECK ("attachment_capabilities"."provider" in ('slack', 'discord'))
);
--> statement-breakpoint
ALTER TABLE "attachment_capabilities" ADD CONSTRAINT "attachment_capabilities_trigger_id_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_capabilities" ADD CONSTRAINT "attachment_capabilities_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_capabilities_trigger_provider_source_unique" ON "attachment_capabilities" USING btree ("trigger_id","provider","source_id");--> statement-breakpoint
CREATE INDEX "attachment_capabilities_trigger_idx" ON "attachment_capabilities" USING btree ("trigger_id");