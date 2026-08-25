ALTER TABLE "agent_executions" ADD COLUMN "deadline_at" timestamp with time zone;
UPDATE "agent_executions"
SET "deadline_at" = "started_at" + interval '30 minutes'
WHERE "status" IN ('spawning', 'running') AND "deadline_at" IS NULL;
