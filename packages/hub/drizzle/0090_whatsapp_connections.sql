CREATE TABLE "whatsapp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"account_id" text NOT NULL,
	"credential_envelope" jsonb NOT NULL,
	"external_identity" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_command_receipts" DROP CONSTRAINT "channel_command_receipts_channel_check";--> statement-breakpoint
ALTER TABLE "channel_commands" DROP CONSTRAINT "channel_commands_channel_check";--> statement-breakpoint
ALTER TABLE "channel_conversation_follow_ups" DROP CONSTRAINT "channel_conversation_follow_ups_channel_check";--> statement-breakpoint
ALTER TABLE "channel_conversation_selections" DROP CONSTRAINT "channel_conversation_selections_channel_check";--> statement-breakpoint
ALTER TABLE "channel_pairings" DROP CONSTRAINT "channel_pairings_channel_check";--> statement-breakpoint
ALTER TABLE "channel_reply_capabilities" DROP CONSTRAINT "channel_reply_capabilities_channel_check";--> statement-breakpoint
ALTER TABLE "channel_state_secrets" DROP CONSTRAINT "channel_state_secrets_channel_check";--> statement-breakpoint
ALTER TABLE "delivery_ledger" DROP CONSTRAINT "delivery_ledger_channel_check";--> statement-breakpoint
ALTER TABLE "thread_bindings" DROP CONSTRAINT "thread_bindings_channel_check";--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_connections_organization_account_unique" ON "whatsapp_connections" USING btree ("organization_id","account_id");--> statement-breakpoint
ALTER TABLE "channel_command_receipts" ADD CONSTRAINT "channel_command_receipts_channel_check" CHECK ("channel_command_receipts"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'whatsapp', 'zalo'));--> statement-breakpoint
ALTER TABLE "channel_commands" ADD CONSTRAINT "channel_commands_channel_check" CHECK ("channel_commands"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'whatsapp', 'zalo'));--> statement-breakpoint
ALTER TABLE "channel_conversation_follow_ups" ADD CONSTRAINT "channel_conversation_follow_ups_channel_check" CHECK ("channel_conversation_follow_ups"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'whatsapp', 'zalo'));--> statement-breakpoint
ALTER TABLE "channel_conversation_selections" ADD CONSTRAINT "channel_conversation_selections_channel_check" CHECK ("channel_conversation_selections"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'whatsapp', 'zalo'));--> statement-breakpoint
ALTER TABLE "channel_pairings" ADD CONSTRAINT "channel_pairings_channel_check" CHECK ("channel_pairings"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'whatsapp', 'zalo'));--> statement-breakpoint
ALTER TABLE "channel_reply_capabilities" ADD CONSTRAINT "channel_reply_capabilities_channel_check" CHECK ("channel_reply_capabilities"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'whatsapp', 'zalo'));--> statement-breakpoint
ALTER TABLE "channel_state_secrets" ADD CONSTRAINT "channel_state_secrets_channel_check" CHECK ("channel_state_secrets"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'whatsapp', 'zalo'));--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD CONSTRAINT "delivery_ledger_channel_check" CHECK ("delivery_ledger"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'whatsapp', 'zalo'));--> statement-breakpoint
ALTER TABLE "thread_bindings" ADD CONSTRAINT "thread_bindings_channel_check" CHECK ("thread_bindings"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'whatsapp', 'zalo'));