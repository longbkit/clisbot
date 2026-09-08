CREATE TABLE "channel_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_commands_channel_check" CHECK ("channel_commands"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'zalo')),
	CONSTRAINT "channel_commands_name_check" CHECK ("channel_commands"."name" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "channel_commands_prompt_check" CHECK (length(trim("channel_commands"."prompt")) > 0)
);
--> statement-breakpoint
ALTER TABLE "access_assignments" DROP CONSTRAINT "access_assignments_subject_kind_check";--> statement-breakpoint
ALTER TABLE "channel_conversation_selections" ADD COLUMN "selected_provider" text;--> statement-breakpoint
ALTER TABLE "channel_conversation_selections" ADD COLUMN "selected_thinking_option" text;--> statement-breakpoint
ALTER TABLE "channel_conversation_selections" ADD COLUMN "selected_mode" text;--> statement-breakpoint
ALTER TABLE "channel_conversation_selections" ADD COLUMN "selected_feature_values" jsonb;--> statement-breakpoint
ALTER TABLE "channel_commands" ADD CONSTRAINT "channel_commands_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_commands_account_name_unique" ON "channel_commands" USING btree ("organization_id","channel","account_id","name");--> statement-breakpoint
ALTER TABLE "access_assignments" ADD CONSTRAINT "access_assignments_subject_kind_check" CHECK ("access_assignments"."subject_kind" in ('member', 'team', 'guest'));
--> statement-breakpoint
CREATE TABLE "channel_command_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"external_conversation_id" text NOT NULL,
	"external_message_id" text NOT NULL,
	"command" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"handled" boolean,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "channel_command_receipts_channel_check" CHECK ("channel_command_receipts"."channel" in ('slack', 'telegram', 'discord', 'googlechat', 'feishu', 'zalouser', 'zalo')),
	CONSTRAINT "channel_command_receipts_status_check" CHECK ("channel_command_receipts"."status" in ('pending', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "channel_command_receipts" ADD CONSTRAINT "channel_command_receipts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_command_receipts_message_unique" ON "channel_command_receipts" USING btree ("organization_id","channel","account_id","external_conversation_id","external_message_id");