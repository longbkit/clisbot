CREATE TABLE "linear_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"linear_organization_id" text NOT NULL,
	"provider_application_id" text,
	"slug" text NOT NULL,
	"linear_organization_name" text NOT NULL,
	"app_user_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "linear_connections_linear_organization_id_unique" UNIQUE("linear_organization_id")
);
--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" DROP CONSTRAINT "organization_connection_attempts_provider_check";--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" DROP CONSTRAINT "organization_connection_attempts_phase_check";--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" DROP CONSTRAINT "organization_connection_attempts_shape_check";--> statement-breakpoint
ALTER TABLE "project_trigger_routes" DROP CONSTRAINT "project_trigger_routes_provider_check";--> statement-breakpoint
ALTER TABLE "provider_event_receipts" DROP CONSTRAINT "provider_event_receipts_provider_check";--> statement-breakpoint
ALTER TABLE "runtime_provider_activation" DROP CONSTRAINT "runtime_provider_activation_provider_check";--> statement-breakpoint
ALTER TABLE "runtime_provider_configuration" DROP CONSTRAINT "runtime_provider_configuration_provider_check";--> statement-breakpoint
ALTER TABLE "linear_connections" ADD CONSTRAINT "linear_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_connections" ADD CONSTRAINT "linear_connections_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linear_connections_id_organization_unique" ON "linear_connections" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linear_connections_organization_slug_unique" ON "linear_connections" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "linear_connections_organization_external_unique" ON "linear_connections" USING btree ("organization_id","linear_organization_id");--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD CONSTRAINT "organization_connection_attempts_provider_check" CHECK ("organization_connection_attempts"."provider" in ('github', 'discord', 'slack', 'linear'));--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD CONSTRAINT "organization_connection_attempts_phase_check" CHECK ("organization_connection_attempts"."phase" in ('github_setup', 'github_user_authorization', 'discord_authorization', 'slack_authorization', 'linear_authorization'));--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD CONSTRAINT "organization_connection_attempts_shape_check" CHECK (("organization_connection_attempts"."phase" = 'github_setup' and "organization_connection_attempts"."provider" = 'github' and "organization_connection_attempts"."candidate_external_id" is null and "organization_connection_attempts"."pkce_verifier" is null)
        or ("organization_connection_attempts"."phase" = 'github_user_authorization' and "organization_connection_attempts"."provider" = 'github' and "organization_connection_attempts"."candidate_external_id" is not null and ("organization_connection_attempts"."pkce_verifier" is not null or "organization_connection_attempts"."consumed_at" is not null))
        or ("organization_connection_attempts"."phase" = 'discord_authorization' and "organization_connection_attempts"."provider" = 'discord' and "organization_connection_attempts"."candidate_external_id" is null and "organization_connection_attempts"."pkce_verifier" is null)
        or ("organization_connection_attempts"."phase" = 'slack_authorization' and "organization_connection_attempts"."provider" = 'slack' and "organization_connection_attempts"."candidate_external_id" is null and "organization_connection_attempts"."pkce_verifier" is null)
        or ("organization_connection_attempts"."phase" = 'linear_authorization' and "organization_connection_attempts"."provider" = 'linear' and "organization_connection_attempts"."candidate_external_id" is null and "organization_connection_attempts"."pkce_verifier" is null));--> statement-breakpoint
ALTER TABLE "project_trigger_routes" ADD CONSTRAINT "project_trigger_routes_provider_check" CHECK ("project_trigger_routes"."provider" in ('github', 'slack', 'discord', 'linear'));--> statement-breakpoint
ALTER TABLE "provider_event_receipts" ADD CONSTRAINT "provider_event_receipts_provider_check" CHECK ("provider_event_receipts"."provider" in ('github', 'slack', 'discord', 'linear', 'manual'));--> statement-breakpoint
ALTER TABLE "runtime_provider_activation" ADD CONSTRAINT "runtime_provider_activation_provider_check" CHECK ("runtime_provider_activation"."provider" in ('github', 'slack', 'discord', 'linear'));--> statement-breakpoint
ALTER TABLE "runtime_provider_configuration" ADD CONSTRAINT "runtime_provider_configuration_provider_check" CHECK ("runtime_provider_configuration"."provider" in ('github', 'slack', 'discord', 'linear'));