ALTER TABLE "delivery_ledger" DROP CONSTRAINT "delivery_ledger_channel_check";--> statement-breakpoint
ALTER TABLE "thread_bindings" DROP CONSTRAINT "thread_bindings_channel_check";--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD CONSTRAINT "delivery_ledger_channel_check" CHECK ("delivery_ledger"."channel" in ('slack', 'telegram', 'discord'));--> statement-breakpoint
ALTER TABLE "thread_bindings" ADD CONSTRAINT "thread_bindings_channel_check" CHECK ("thread_bindings"."channel" in ('slack', 'telegram', 'discord'));