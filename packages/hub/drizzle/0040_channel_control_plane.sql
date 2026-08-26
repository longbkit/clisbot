CREATE TABLE "channel_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"status" text NOT NULL,
	"pin_version" text,
	"dist_integrity" text,
	"git_head" text,
	"install_dir" text,
	"installed_at" timestamp with time zone,
	"secret_ref" text,
	"provider_application_id" text,
	"external_identity" jsonb,
	"transport" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_accounts_status_check" CHECK ("channel_accounts"."status" in ('installing', 'active', 'suspended', 'failed')),
	CONSTRAINT "channel_accounts_channel_check" CHECK ("channel_accounts"."channel" in ('slack', 'telegram'))
);
--> statement-breakpoint
CREATE TABLE "delivery_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"external_thread_id" text,
	"event_turn_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"status" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone,
	"native_message_id" text,
	"failure_reason" text,
	CONSTRAINT "delivery_ledger_status_check" CHECK ("delivery_ledger"."status" in ('recorded', 'posted', 'failed')),
	CONSTRAINT "delivery_ledger_channel_check" CHECK ("delivery_ledger"."channel" in ('slack', 'telegram')),
	CONSTRAINT "delivery_ledger_sequence_check" CHECK ("delivery_ledger"."sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "thread_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"external_thread_id" text,
	"status" text NOT NULL,
	"pending_execution_id" text,
	"agent_id" text,
	"daemon_id" uuid,
	"initiator" text NOT NULL,
	"route" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "thread_bindings_status_check" CHECK ("thread_bindings"."status" in ('pending', 'bound', 'abandoned')),
	CONSTRAINT "thread_bindings_channel_check" CHECK ("thread_bindings"."channel" in ('slack', 'telegram')),
	CONSTRAINT "thread_bindings_shape_check" CHECK (("thread_bindings"."status" = 'bound' and "thread_bindings"."agent_id" is not null and "thread_bindings"."pending_execution_id" is null and "thread_bindings"."resolved_at" is not null)
        or ("thread_bindings"."status" = 'pending' and "thread_bindings"."agent_id" is null and "thread_bindings"."pending_execution_id" is not null and "thread_bindings"."resolved_at" is null)
        or ("thread_bindings"."status" = 'abandoned' and "thread_bindings"."agent_id" is null and "thread_bindings"."resolved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ledger" ADD CONSTRAINT "delivery_ledger_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_bindings" ADD CONSTRAINT "thread_bindings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_accounts_organization_channel_account_unique" ON "channel_accounts" USING btree ("organization_id","channel","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_ledger_event_turn_sequence_unique" ON "delivery_ledger" USING btree ("organization_id","account_id","conversation_id","external_thread_id","event_turn_id","sequence");--> statement-breakpoint
CREATE INDEX "delivery_ledger_account_created_idx" ON "delivery_ledger" USING btree ("account_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "thread_bindings_account_thread_unique" ON "thread_bindings" USING btree ("organization_id","account_id","conversation_id","external_thread_id");--> statement-breakpoint
CREATE INDEX "thread_bindings_agent_idx" ON "thread_bindings" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "thread_bindings_account_created_idx" ON "thread_bindings" USING btree ("account_id","created_at" DESC NULLS LAST);