ALTER TABLE "triggers" ADD COLUMN "dispatch_plan" jsonb;--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "lifecycle_state" text;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_lifecycle_state_check" CHECK ("triggers"."lifecycle_state" is null or "triggers"."lifecycle_state" in ('accepted', 'running', 'succeeded', 'failed'));