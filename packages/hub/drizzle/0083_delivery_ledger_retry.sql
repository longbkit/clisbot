ALTER TABLE "delivery_ledger" ADD COLUMN "retry_payload" jsonb;--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "delivery_ledger_retry_due_idx" ON "delivery_ledger" USING btree ("organization_id","channel","account_id","next_attempt_at") WHERE "delivery_ledger"."next_attempt_at" is not null;