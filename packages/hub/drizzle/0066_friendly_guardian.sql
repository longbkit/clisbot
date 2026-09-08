ALTER TABLE "channel_ingress_queue" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_ingress_queue" ADD COLUMN "failed_reason" text;--> statement-breakpoint
ALTER TABLE "channel_ingress_queue" ADD COLUMN "failed_at" timestamp with time zone;