ALTER TABLE "delivery_ledger" RENAME COLUMN "conversation_id" TO "external_conversation_id";--> statement-breakpoint
ALTER TABLE "delivery_ledger" RENAME COLUMN "native_message_id" TO "external_message_id";--> statement-breakpoint
ALTER TABLE "thread_bindings" RENAME COLUMN "conversation_id" TO "external_conversation_id";--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD COLUMN "direction" text DEFAULT 'out' NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD COLUMN "turn_id" text;--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_ledger" DROP CONSTRAINT "delivery_ledger_status_check";--> statement-breakpoint
DROP INDEX "delivery_ledger_event_turn_sequence_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_ledger_event_turn_sequence_unique" ON "delivery_ledger" USING btree ("organization_id","account_id","external_conversation_id","external_thread_id","event_turn_id","sequence") WHERE "delivery_ledger"."direction" = 'out';--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_ledger_inbound_message_unique" ON "delivery_ledger" USING btree ("organization_id","account_id","external_conversation_id","external_message_id") WHERE "delivery_ledger"."direction" = 'in';--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD CONSTRAINT "delivery_ledger_status_check" CHECK ("delivery_ledger"."status" in ('recorded', 'posted', 'failed', 'consumed'));--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD CONSTRAINT "delivery_ledger_direction_check" CHECK ("delivery_ledger"."direction" in ('in', 'out'));--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD CONSTRAINT "delivery_ledger_attempts_check" CHECK ("delivery_ledger"."attempts" >= 1);--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD CONSTRAINT "delivery_ledger_inbound_shape_check" CHECK (("delivery_ledger"."direction" = 'in' and "delivery_ledger"."event_turn_id" = '' and "delivery_ledger"."sequence" = 0 and "delivery_ledger"."external_message_id" is not null and "delivery_ledger"."status" in ('recorded', 'consumed') and "delivery_ledger"."consumed_at" is not null = ("delivery_ledger"."status" = 'consumed') and "delivery_ledger"."turn_id" is not null = ("delivery_ledger"."status" = 'consumed'))
        or ("delivery_ledger"."direction" = 'out' and "delivery_ledger"."status" in ('recorded', 'posted', 'failed')));
