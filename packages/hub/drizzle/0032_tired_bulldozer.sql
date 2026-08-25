CREATE TABLE "cli_authorizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_verifier" text NOT NULL,
	"user_code_verifier" text NOT NULL,
	"fingerprint_verifier" text NOT NULL,
	"status" text NOT NULL,
	"poll_interval_seconds" integer NOT NULL,
	"next_poll_at" timestamp with time zone NOT NULL,
	"approved_organization_id" text,
	"approved_by_user_id" text,
	"decided_at" timestamp with time zone,
	"credential_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cli_authorizations_device_verifier_unique" UNIQUE("device_verifier"),
	CONSTRAINT "cli_authorizations_user_code_verifier_unique" UNIQUE("user_code_verifier"),
	CONSTRAINT "cli_authorizations_credential_id_unique" UNIQUE("credential_id"),
	CONSTRAINT "cli_authorizations_status_check" CHECK ("cli_authorizations"."status" in ('pending', 'approved', 'denied', 'expired', 'disclosed')),
	CONSTRAINT "cli_authorizations_poll_interval_check" CHECK ("cli_authorizations"."poll_interval_seconds" >= 5)
);
--> statement-breakpoint
CREATE TABLE "organization_cli_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"prefix" text NOT NULL,
	"verifier" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "daemon_device_authorizations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "daemon_device_authorizations" CASCADE;--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" DROP CONSTRAINT "daemon_enrollment_tokens_authorization_id_unique";--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" DROP CONSTRAINT "daemon_enrollment_tokens_registration_method_check";--> statement-breakpoint
ALTER TABLE "daemons" DROP CONSTRAINT "daemons_registration_method_check";--> statement-breakpoint
ALTER TABLE "organization_api_keys" DROP CONSTRAINT "organization_api_keys_scopes_check";--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" ADD COLUMN "issued_by_cli_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "daemons" ADD COLUMN "registered_by_cli_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_cli_credentials" ADD CONSTRAINT "organization_cli_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_cli_credentials" ADD CONSTRAINT "organization_cli_credentials_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cli_authorizations_fingerprint_idx" ON "cli_authorizations" USING btree ("fingerprint_verifier","expires_at");--> statement-breakpoint
CREATE INDEX "cli_authorizations_status_expiry_idx" ON "cli_authorizations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_cli_credentials_prefix_unique" ON "organization_cli_credentials" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "organization_cli_credentials_organization_created_idx" ON "organization_cli_credentials" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" ADD CONSTRAINT "daemon_enrollment_tokens_issued_by_cli_credential_id_organization_cli_credentials_id_fk" FOREIGN KEY ("issued_by_cli_credential_id") REFERENCES "public"."organization_cli_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemons" ADD CONSTRAINT "daemons_registered_by_cli_credential_id_organization_cli_credentials_id_fk" FOREIGN KEY ("registered_by_cli_credential_id") REFERENCES "public"."organization_cli_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" DROP COLUMN "authorization_id";--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" DROP COLUMN "slug";--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" DROP COLUMN "approved_by_user_id";--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" DROP COLUMN "registration_method";--> statement-breakpoint
ALTER TABLE "daemons" DROP COLUMN "approved_by_user_id";--> statement-breakpoint
ALTER TABLE "daemons" DROP COLUMN "registration_method";--> statement-breakpoint
ALTER TABLE "organization_api_keys" ADD CONSTRAINT "organization_api_keys_scopes_check" CHECK ("organization_api_keys"."scopes" <@ ARRAY['projects:read', 'configuration:validate', 'configuration:install', 'runs:dispatch', 'daemons:enroll']::text[] and cardinality("organization_api_keys"."scopes") > 0);