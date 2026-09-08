CREATE TABLE "channel_reply_capabilities" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel_revision_id" text,
	"route_position" text NOT NULL,
	"route_fingerprint" text NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"external_conversation_id" text NOT NULL,
	"external_thread_id" text,
	"project_root" text,
	"output_budget" jsonb,
	"agent_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_reply_capabilities_channel_check" CHECK ("channel_reply_capabilities"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'zalo'))
);
--> statement-breakpoint
ALTER TABLE "channel_reply_capabilities" ADD CONSTRAINT "channel_reply_capabilities_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_reply_capabilities_account_idx" ON "channel_reply_capabilities" USING btree ("organization_id","channel","account_id");--> statement-breakpoint
CREATE INDEX "channel_reply_capabilities_expires_at_idx" ON "channel_reply_capabilities" USING btree ("expires_at");