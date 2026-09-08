CREATE TABLE "channel_state_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"namespace" text NOT NULL,
	"state_envelope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_state_secrets_channel_check" CHECK ("channel_state_secrets"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'zalo'))
);
--> statement-breakpoint
CREATE TABLE "zalouser_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"credential_envelope" jsonb NOT NULL,
	"external_identity" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_ledger" DROP CONSTRAINT "delivery_ledger_channel_check";--> statement-breakpoint
ALTER TABLE "thread_bindings" DROP CONSTRAINT "thread_bindings_channel_check";--> statement-breakpoint
ALTER TABLE "channel_state_secrets" ADD CONSTRAINT "channel_state_secrets_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalouser_connections" ADD CONSTRAINT "zalouser_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_state_secrets_namespace_unique" ON "channel_state_secrets" USING btree ("organization_id","channel","account_id","namespace");--> statement-breakpoint
CREATE UNIQUE INDEX "zalouser_connections_organization_account_unique" ON "zalouser_connections" USING btree ("organization_id","account_id");--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD CONSTRAINT "delivery_ledger_channel_check" CHECK ("delivery_ledger"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'zalo'));--> statement-breakpoint
ALTER TABLE "thread_bindings" ADD CONSTRAINT "thread_bindings_channel_check" CHECK ("thread_bindings"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'zalo'));