CREATE TABLE "discord_guild_bindings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"guild_name" text NOT NULL,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_guild_bindings_guild_id_unique" UNIQUE("guild_id")
);
--> statement-breakpoint
CREATE TABLE "github_installation_bindings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"status" text NOT NULL,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_at" timestamp with time zone,
	CONSTRAINT "github_installation_bindings_installation_id_unique" UNIQUE("installation_id"),
	CONSTRAINT "github_installation_bindings_status_check" CHECK ("github_installation_bindings"."status" in ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "organization_connection_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"phase" text NOT NULL,
	"state_verifier" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"candidate_external_id" text,
	"pkce_verifier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "organization_connection_attempts_state_verifier_unique" UNIQUE("state_verifier"),
	CONSTRAINT "organization_connection_attempts_provider_check" CHECK ("organization_connection_attempts"."provider" in ('github', 'discord')),
	CONSTRAINT "organization_connection_attempts_phase_check" CHECK ("organization_connection_attempts"."phase" in ('github_setup', 'github_user_authorization', 'discord_authorization')),
	CONSTRAINT "organization_connection_attempts_shape_check" CHECK (("organization_connection_attempts"."phase" = 'github_setup' and "organization_connection_attempts"."provider" = 'github' and "organization_connection_attempts"."candidate_external_id" is null and "organization_connection_attempts"."pkce_verifier" is null)
        or ("organization_connection_attempts"."phase" = 'github_user_authorization' and "organization_connection_attempts"."provider" = 'github' and "organization_connection_attempts"."candidate_external_id" is not null and ("organization_connection_attempts"."pkce_verifier" is not null or "organization_connection_attempts"."consumed_at" is not null))
        or ("organization_connection_attempts"."phase" = 'discord_authorization' and "organization_connection_attempts"."provider" = 'discord' and "organization_connection_attempts"."candidate_external_id" is null and "organization_connection_attempts"."pkce_verifier" is null))
);
--> statement-breakpoint
ALTER TABLE "daemons" DROP CONSTRAINT "daemons_slug_key";--> statement-breakpoint
ALTER TABLE "daemons" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "daemons"
SET "organization_id" = "machines"."org_id"
FROM "machines"
WHERE "machines"."id" = "daemons"."machine_id";--> statement-breakpoint
ALTER TABLE "daemons" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "daemons" DROP CONSTRAINT IF EXISTS "daemons_machine_id_machines_id_fk";--> statement-breakpoint
ALTER TABLE "daemons" DROP CONSTRAINT IF EXISTS "daemons_machine_id_fkey";--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "triggers"
SET "organization_id" = proven."org_id"
FROM (
	SELECT
		agent_executions.trigger_id,
		min(machines.org_id) AS org_id
	FROM agent_executions
	JOIN machines ON machines.id = agent_executions.machine_id
	WHERE agent_executions.trigger_id IS NOT NULL
	GROUP BY agent_executions.trigger_id
	HAVING count(DISTINCT machines.org_id) = 1
) AS proven
WHERE triggers.id = proven.trigger_id;--> statement-breakpoint
UPDATE "triggers"
SET "dropped_reason" = 'legacy_unscoped'
WHERE "organization_id" IS NULL AND "dropped_reason" IS NULL;--> statement-breakpoint
ALTER TABLE "discord_guild_bindings" ADD CONSTRAINT "discord_guild_bindings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_guild_bindings" ADD CONSTRAINT "discord_guild_bindings_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installation_bindings" ADD CONSTRAINT "github_installation_bindings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installation_bindings" ADD CONSTRAINT "github_installation_bindings_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD CONSTRAINT "organization_connection_attempts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD CONSTRAINT "organization_connection_attempts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD CONSTRAINT "organization_connection_attempts_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_connection_attempts_expiry_idx" ON "organization_connection_attempts" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "machines_id_org_id_unique" ON "machines" USING btree ("id","org_id");--> statement-breakpoint
ALTER TABLE "daemons" ADD CONSTRAINT "daemons_machine_organization_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machines"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daemons_organization_slug_unique" ON "daemons" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "triggers_organization_received_at_idx" ON "triggers" USING btree ("organization_id","received_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_organization_or_dropped_check" CHECK ("triggers"."organization_id" is not null or "triggers"."dropped_reason" is not null);
