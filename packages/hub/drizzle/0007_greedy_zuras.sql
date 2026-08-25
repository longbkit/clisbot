CREATE TABLE "slack_workspace_bindings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"bot_access_token" text NOT NULL,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_workspace_bindings_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" DROP CONSTRAINT "organization_connection_attempts_provider_check";--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" DROP CONSTRAINT "organization_connection_attempts_phase_check";--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" DROP CONSTRAINT "organization_connection_attempts_shape_check";--> statement-breakpoint
ALTER TABLE "slack_workspace_bindings" ADD CONSTRAINT "slack_workspace_bindings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_workspace_bindings" ADD CONSTRAINT "slack_workspace_bindings_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD CONSTRAINT "organization_connection_attempts_provider_check" CHECK ("organization_connection_attempts"."provider" in ('github', 'discord', 'slack'));--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD CONSTRAINT "organization_connection_attempts_phase_check" CHECK ("organization_connection_attempts"."phase" in ('github_setup', 'github_user_authorization', 'discord_authorization', 'slack_authorization'));--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD CONSTRAINT "organization_connection_attempts_shape_check" CHECK (("organization_connection_attempts"."phase" = 'github_setup' and "organization_connection_attempts"."provider" = 'github' and "organization_connection_attempts"."candidate_external_id" is null and "organization_connection_attempts"."pkce_verifier" is null)
        or ("organization_connection_attempts"."phase" = 'github_user_authorization' and "organization_connection_attempts"."provider" = 'github' and "organization_connection_attempts"."candidate_external_id" is not null and ("organization_connection_attempts"."pkce_verifier" is not null or "organization_connection_attempts"."consumed_at" is not null))
        or ("organization_connection_attempts"."phase" = 'discord_authorization' and "organization_connection_attempts"."provider" = 'discord' and "organization_connection_attempts"."candidate_external_id" is null and "organization_connection_attempts"."pkce_verifier" is null)
        or ("organization_connection_attempts"."phase" = 'slack_authorization' and "organization_connection_attempts"."provider" = 'slack' and "organization_connection_attempts"."candidate_external_id" is null and "organization_connection_attempts"."pkce_verifier" is null));