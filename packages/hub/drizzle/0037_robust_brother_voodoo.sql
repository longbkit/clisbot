CREATE TABLE "runtime_provider_activation" (
	"provider" text PRIMARY KEY NOT NULL,
	"provider_application_id" text NOT NULL,
	"configuration_version" integer NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_provider_activation_provider_check" CHECK ("runtime_provider_activation"."provider" in ('github', 'slack', 'discord')),
	CONSTRAINT "runtime_provider_activation_version_check" CHECK ("runtime_provider_activation"."configuration_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD COLUMN "provider_application_id" text;