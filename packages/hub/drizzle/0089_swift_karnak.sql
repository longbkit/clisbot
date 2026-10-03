ALTER TABLE "daemon_access_leases" ADD COLUMN "account_session_id" text;--> statement-breakpoint
ALTER TABLE "daemon_access_tickets" ADD COLUMN "account_session_id" text;