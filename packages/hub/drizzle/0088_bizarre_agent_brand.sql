ALTER TABLE "daemon_access_leases" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "daemon_access_leases" ADD COLUMN "device_account_authenticated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "daemon_access_tickets" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "daemon_access_tickets" ADD COLUMN "device_account_authenticated" boolean DEFAULT false NOT NULL;