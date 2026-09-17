CREATE TABLE "channel_conversation_follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"external_conversation_id" text NOT NULL,
	"external_thread_id" text,
	"mode" text NOT NULL,
	"set_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_conversation_follow_ups_channel_check" CHECK ("channel_conversation_follow_ups"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'zalo')),
	CONSTRAINT "channel_conversation_follow_ups_mode_check" CHECK ("channel_conversation_follow_ups"."mode" in ('auto', 'mention-only', 'paused'))
);
--> statement-breakpoint
ALTER TABLE "channel_conversation_follow_ups" ADD CONSTRAINT "channel_conversation_follow_ups_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_conversation_follow_ups_key_unique" ON "channel_conversation_follow_ups" USING btree ("organization_id","channel","account_id","external_conversation_id",coalesce("external_thread_id", ''));