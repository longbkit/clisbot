ALTER TABLE "agent_executions" ADD COLUMN "hub_action" text;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "hub_action_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_hub_action_check" CHECK ("agent_executions"."hub_action" is null or "agent_executions"."hub_action" in ('interrupt', 'archive'));--> statement-breakpoint
UPDATE "agent_executions"
SET "hub_action_completed_at" = COALESCE("completed_at", now())
WHERE "status" IN ('succeeded', 'failed');
