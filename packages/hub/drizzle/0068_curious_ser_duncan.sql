CREATE TABLE "discord_bot_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"credential_envelope" jsonb NOT NULL,
	"external_identity" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discord_bot_connections" ADD CONSTRAINT "discord_bot_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discord_bot_connections_organization_account_unique" ON "discord_bot_connections" USING btree ("organization_id","account_id");