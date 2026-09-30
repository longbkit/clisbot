ALTER TABLE "cli_authorizations" ADD COLUMN "enrollment" jsonb;--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" ADD COLUMN "enrollment" jsonb;