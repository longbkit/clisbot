CREATE TYPE "public"."run_status" AS ENUM('spawning', 'running', 'succeeded', 'failed', 'timed_out', 'canceled');--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"mode" text NOT NULL,
	"container_or_machine_id" text,
	"status" "run_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"transcript" jsonb
);
--> statement-breakpoint
CREATE TABLE "triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" text NOT NULL,
	"source" text NOT NULL,
	"repo" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"matched_trigger_name" text,
	"dropped_reason" text
);
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_trigger_id_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."triggers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_trigger_id_idx" ON "runs" USING btree ("trigger_id");--> statement-breakpoint
CREATE UNIQUE INDEX "triggers_delivery_id_unique" ON "triggers" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "triggers_received_at_idx" ON "triggers" USING btree ("received_at" DESC NULLS LAST);