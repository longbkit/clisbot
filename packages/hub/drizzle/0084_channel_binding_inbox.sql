ALTER TABLE "channel_ingress_queue" ADD COLUMN "binding_key" text;--> statement-breakpoint
ALTER TABLE "channel_ingress_queue" ADD COLUMN "inbox_state" text;--> statement-breakpoint
ALTER TABLE "channel_ingress_queue" ADD COLUMN "sent_in" text;--> statement-breakpoint
CREATE INDEX "channel_ingress_queue_inbox_idx" ON "channel_ingress_queue" USING btree ("organization_id","channel","account_id","binding_key","inbox_state","created_at") WHERE "channel_ingress_queue"."inbox_state" is not null;--> statement-breakpoint
CREATE INDEX "channel_ingress_queue_sent_in_idx" ON "channel_ingress_queue" USING btree ("organization_id","sent_in") WHERE "channel_ingress_queue"."sent_in" is not null;--> statement-breakpoint
ALTER TABLE "channel_ingress_queue" ADD CONSTRAINT "channel_ingress_queue_inbox_state_check" CHECK ("channel_ingress_queue"."inbox_state" is null or "channel_ingress_queue"."inbox_state" in ('context', 'held', 'delivered'));