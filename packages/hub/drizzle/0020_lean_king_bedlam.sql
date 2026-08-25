ALTER TABLE "trigger_runs" ADD COLUMN "terminal_notification_pending_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trigger_runs" ADD COLUMN "terminal_notification_delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trigger_runs" ADD COLUMN "terminal_notification_lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "trigger_runs_terminal_notification_idx" ON "trigger_runs" USING btree ("terminal_notification_delivered_at","terminal_notification_lease_expires_at");