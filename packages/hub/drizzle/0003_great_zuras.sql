CREATE TABLE "daemon_device_authorizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_verifier" text NOT NULL,
	"user_code_verifier" text NOT NULL,
	"fingerprint_verifier" text NOT NULL,
	"suggested_display_name" text NOT NULL,
	"status" text NOT NULL,
	"poll_interval_seconds" integer NOT NULL,
	"next_poll_at" timestamp with time zone NOT NULL,
	"approved_organization_id" text,
	"approved_by_user_id" text,
	"approved_display_name" text,
	"decided_at" timestamp with time zone,
	"enrollment_token_id" uuid,
	"enrolled_daemon_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "daemon_device_authorizations_device_verifier_unique" UNIQUE("device_verifier"),
	CONSTRAINT "daemon_device_authorizations_user_code_verifier_unique" UNIQUE("user_code_verifier"),
	CONSTRAINT "daemon_device_authorizations_enrollment_token_id_unique" UNIQUE("enrollment_token_id"),
	CONSTRAINT "daemon_device_authorizations_enrolled_daemon_id_unique" UNIQUE("enrolled_daemon_id"),
	CONSTRAINT "daemon_device_authorizations_status_check" CHECK ("daemon_device_authorizations"."status" in ('pending', 'approved', 'denied', 'expired', 'enrolled')),
	CONSTRAINT "daemon_device_authorizations_poll_interval_check" CHECK ("daemon_device_authorizations"."poll_interval_seconds" >= 5)
);
--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" ADD COLUMN "authorization_id" uuid;--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" ADD COLUMN "approved_by_user_id" text;--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" ADD COLUMN "registration_method" text DEFAULT 'operator' NOT NULL;--> statement-breakpoint
ALTER TABLE "daemons" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "daemons" ADD COLUMN "approved_by_user_id" text;--> statement-breakpoint
ALTER TABLE "daemons" ADD COLUMN "registration_method" text DEFAULT 'operator' NOT NULL;--> statement-breakpoint
CREATE INDEX "daemon_device_authorizations_fingerprint_idx" ON "daemon_device_authorizations" USING btree ("fingerprint_verifier","expires_at");--> statement-breakpoint
CREATE INDEX "daemon_device_authorizations_status_expiry_idx" ON "daemon_device_authorizations" USING btree ("status","expires_at");--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" ADD CONSTRAINT "daemon_enrollment_tokens_authorization_id_unique" UNIQUE("authorization_id");--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" ADD CONSTRAINT "daemon_enrollment_tokens_registration_method_check" CHECK ("daemon_enrollment_tokens"."registration_method" in ('operator', 'device'));--> statement-breakpoint
ALTER TABLE "daemons" ADD CONSTRAINT "daemons_registration_method_check" CHECK ("daemons"."registration_method" in ('operator', 'device'));
