ALTER TABLE "linear_connections" ADD COLUMN "credential_envelope" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD COLUMN "configuration_envelope" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_configuration" ADD COLUMN "auth_secret_envelope" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_provider_configuration" ADD COLUMN "configuration_envelope" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_connections" ADD COLUMN "credential_envelope" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "linear_connections" DROP COLUMN "access_token";--> statement-breakpoint
ALTER TABLE "linear_connections" DROP COLUMN "refresh_token";--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" DROP COLUMN "configuration_snapshot";--> statement-breakpoint
ALTER TABLE "runtime_configuration" DROP COLUMN "auth_secret";--> statement-breakpoint
ALTER TABLE "runtime_provider_configuration" DROP COLUMN "configuration";--> statement-breakpoint
ALTER TABLE "slack_connections" DROP COLUMN "bot_access_token";