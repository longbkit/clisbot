ALTER TABLE "agent_executions" ADD COLUMN "reaction_state" jsonb;--> statement-breakpoint
ALTER TABLE "trigger_runs" ADD COLUMN "reaction_state" jsonb;