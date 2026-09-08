CREATE TABLE "channel_ingress_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"external_event_id" text NOT NULL,
	"external_message_id" text NOT NULL,
	"external_conversation_id" text NOT NULL,
	"external_thread_id" text,
	"lane_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" text,
	"claim_token" text,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "channel_ingress_queue_status_check" CHECK ("channel_ingress_queue"."status" in ('pending', 'claimed', 'completed', 'failed', 'dead_letter')),
	CONSTRAINT "channel_ingress_queue_attempts_check" CHECK ("channel_ingress_queue"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "channel_ingress_queue" ADD CONSTRAINT "channel_ingress_queue_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_ingress_queue_event_unique" ON "channel_ingress_queue" USING btree ("organization_id","channel","account_id","external_event_id");--> statement-breakpoint
CREATE INDEX "channel_ingress_queue_claim_idx" ON "channel_ingress_queue" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "channel_ingress_queue_lane_idx" ON "channel_ingress_queue" USING btree ("organization_id","channel","account_id","lane_key","created_at");