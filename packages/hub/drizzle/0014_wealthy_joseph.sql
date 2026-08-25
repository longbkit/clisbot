ALTER TABLE "daemon_enrollment_tokens" ADD COLUMN "issued_by_api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "daemons" ADD COLUMN "registered_by_api_key_id" uuid;