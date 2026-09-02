DROP INDEX "delivery_ledger_event_turn_sequence_unique";--> statement-breakpoint
DROP INDEX "thread_bindings_account_thread_unique";--> statement-breakpoint
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY organization_id, account_id, external_conversation_id,
                        coalesce(external_thread_id, ''), event_turn_id, sequence
           ORDER BY CASE status WHEN 'posted' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,
                    posted_at DESC NULLS LAST, recorded_at DESC, id DESC
         ) AS duplicate_rank
  FROM delivery_ledger
  WHERE direction = 'out'
)
DELETE FROM delivery_ledger
USING ranked
WHERE delivery_ledger.id = ranked.id AND ranked.duplicate_rank > 1;--> statement-breakpoint
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY organization_id, account_id, external_conversation_id,
                        coalesce(external_thread_id, '')
           ORDER BY CASE status WHEN 'bound' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                    resolved_at DESC NULLS LAST, created_at DESC, id DESC
         ) AS duplicate_rank
  FROM thread_bindings
)
DELETE FROM thread_bindings
USING ranked
WHERE thread_bindings.id = ranked.id AND ranked.duplicate_rank > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_ledger_event_turn_sequence_unique" ON "delivery_ledger" USING btree ("organization_id","account_id","external_conversation_id",coalesce("external_thread_id", ''),"event_turn_id","sequence") WHERE "delivery_ledger"."direction" = 'out';--> statement-breakpoint
CREATE UNIQUE INDEX "thread_bindings_account_thread_unique" ON "thread_bindings" USING btree ("organization_id","account_id","external_conversation_id",coalesce("external_thread_id", ''));
