CREATE TYPE "public"."machine_status" AS ENUM('spawning', 'alive', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."agent_execution_status" AS ENUM('spawning', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source" jsonb NOT NULL,
	"status" "machine_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terminated_at" timestamp with time zone,
	"shutdown_reason" text,
	"hub_config_version_id" uuid,
	"trigger_name" text,
	"trigger_context" jsonb,
	"specs" jsonb
);
--> statement-breakpoint
CREATE TABLE "agent_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"machine_id" uuid NOT NULL,
	"status" "agent_execution_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"result" jsonb,
	"trigger_context" jsonb,
	"output_context" jsonb,
	"hub_config_version_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "machines_org_id_idx" ON "machines" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "machines_status_idx" ON "machines" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_executions_machine_id_idx" ON "agent_executions" USING btree ("machine_id");--> statement-breakpoint
CREATE INDEX "agent_executions_status_idx" ON "agent_executions" USING btree ("status");--> statement-breakpoint
DROP TABLE "runs";--> statement-breakpoint
DROP TYPE "public"."run_status";
