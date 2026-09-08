CREATE TABLE "feishu_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"credential_envelope" jsonb NOT NULL,
	"external_identity" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "googlechat_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"credential_envelope" jsonb NOT NULL,
	"external_identity" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zalo_connections" (
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
ALTER TABLE "feishu_connections" ADD CONSTRAINT "feishu_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "googlechat_connections" ADD CONSTRAINT "googlechat_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zalo_connections" ADD CONSTRAINT "zalo_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feishu_connections_organization_account_unique" ON "feishu_connections" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "googlechat_connections_organization_account_unique" ON "googlechat_connections" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zalo_connections_organization_account_unique" ON "zalo_connections" USING btree ("organization_id","account_id");--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD CONSTRAINT "delivery_ledger_channel_check" CHECK ("delivery_ledger"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalo'));--> statement-breakpoint
ALTER TABLE "thread_bindings" ADD CONSTRAINT "thread_bindings_channel_check" CHECK ("thread_bindings"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalo'));