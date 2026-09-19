CREATE TABLE "access_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_events_kind_check" CHECK ("access_events"."kind" in ('administrator_granted'))
);
--> statement-breakpoint
ALTER TABLE "access_assignments" DROP CONSTRAINT "access_assignments_resource_kind_check";--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_events_organization_created_idx" ON "access_events" USING btree ("organization_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "access_assignments" ADD CONSTRAINT "access_assignments_resource_kind_check" CHECK ("access_assignments"."resource_kind" in ('organization', 'daemon', 'project', 'team', 'channel_account', 'automation'));