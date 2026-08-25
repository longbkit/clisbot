ALTER TABLE "agent_executions" ADD COLUMN "completion_token_hash" text;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "completed_by_agent_at" timestamp with time zone;
