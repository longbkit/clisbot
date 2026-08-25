CREATE TABLE "hub_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "version" integer NOT NULL,
  "source" jsonb NOT NULL,
  "config" jsonb NOT NULL,
  "errors" jsonb,
  "is_current" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "hub_configs_org_name_version_idx" ON "hub_configs" USING btree ("org_id", "name", "version");
--> statement-breakpoint
CREATE UNIQUE INDEX "hub_configs_current_idx" ON "hub_configs" USING btree ("org_id", "name") WHERE "is_current";
--> statement-breakpoint
CREATE INDEX "hub_configs_github_index_idx" ON "hub_configs" USING gin ((("config" -> 'indexes') -> 'github'));
--> statement-breakpoint
CREATE INDEX "hub_configs_discord_index_idx" ON "hub_configs" USING gin ((("config" -> 'indexes') -> 'discord'));
--> statement-breakpoint
ALTER TABLE "agent_executions" ALTER COLUMN "hub_config_version_id" TYPE uuid USING "hub_config_version_id"::uuid;
--> statement-breakpoint
ALTER TABLE "machines" ALTER COLUMN "hub_config_version_id" TYPE uuid USING "hub_config_version_id"::uuid;
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_hub_config_version_id_hub_configs_id_fk" FOREIGN KEY ("hub_config_version_id") REFERENCES "public"."hub_configs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_hub_config_version_id_hub_configs_id_fk" FOREIGN KEY ("hub_config_version_id") REFERENCES "public"."hub_configs"("id") ON DELETE no action ON UPDATE no action;
