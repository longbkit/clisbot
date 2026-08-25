ALTER TABLE "agent_executions" ADD COLUMN "reply_claim_count" integer DEFAULT 0 NOT NULL;
UPDATE "agent_executions"
SET "reply_claim_count" = 1
WHERE "reply_claimed_at" IS NOT NULL;
