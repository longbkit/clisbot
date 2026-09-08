CREATE TABLE "channel_conversation_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"external_conversation_id" text NOT NULL,
	"external_thread_id" text,
	"selected_agent" text,
	"selected_model" text,
	"selected_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_conversation_selections_channel_check" CHECK ("channel_conversation_selections"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'zalo'))
);
--> statement-breakpoint
CREATE TABLE "channel_pairings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"sender_identity" text NOT NULL,
	"sender_name" text,
	"code" text NOT NULL,
	"status" text NOT NULL,
	"external_conversation_id" text NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_pairings_channel_check" CHECK ("channel_pairings"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'zalo')),
	CONSTRAINT "channel_pairings_status_check" CHECK ("channel_pairings"."status" in ('pending', 'approved', 'denied'))
);
--> statement-breakpoint
ALTER TABLE "channel_conversation_selections" ADD CONSTRAINT "channel_conversation_selections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_pairings" ADD CONSTRAINT "channel_pairings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_pairings" ADD CONSTRAINT "channel_pairings_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_conversation_selections_key_unique" ON "channel_conversation_selections" USING btree ("organization_id","account_id","external_conversation_id",coalesce("external_thread_id", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "channel_pairings_account_sender_unique" ON "channel_pairings" USING btree ("organization_id","channel","account_id","sender_identity");--> statement-breakpoint
CREATE INDEX "channel_pairings_account_status_idx" ON "channel_pairings" USING btree ("organization_id","channel","account_id","status");