ALTER TABLE "access_events" DROP CONSTRAINT "access_events_kind_check";--> statement-breakpoint
ALTER TABLE "organization_triggers" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_kind_check" CHECK ("access_events"."kind" in ('administrator_granted', 'automation_paused'));