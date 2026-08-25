CREATE TABLE "trigger_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"configuration_revision_id" uuid NOT NULL,
	"provider_event_receipt_id" uuid NOT NULL,
	"configured_trigger_name" text NOT NULL,
	"outcome" text DEFAULT 'accepted' NOT NULL,
	"status" text NOT NULL,
	"raw_prompt" text NOT NULL,
	"prompt" text NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trigger_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deadline_at" timestamp with time zone,
	"deadline_kind" text,
	"failure_reason" text,
	"rejection" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "trigger_runs_status_check" CHECK ("trigger_runs"."status" in ('running', 'succeeded', 'failed', 'timed_out', 'rejected')),
	CONSTRAINT "trigger_runs_outcome_check" CHECK (("trigger_runs"."outcome" = 'accepted' and "trigger_runs"."status" <> 'rejected' and "trigger_runs"."rejection" is null)
        or ("trigger_runs"."outcome" = 'rejected' and "trigger_runs"."status" = 'rejected' and "trigger_runs"."rejection" is not null)),
	CONSTRAINT "trigger_runs_deadline_kind_check" CHECK ("trigger_runs"."deadline_kind" is null or "trigger_runs"."deadline_kind" in ('step_hard', 'step_idle', 'whole_run')),
	CONSTRAINT "trigger_runs_deadline_shape_check" CHECK (("trigger_runs"."outcome" = 'accepted' and "trigger_runs"."deadline_at" is not null)
        or ("trigger_runs"."outcome" = 'rejected' and "trigger_runs"."deadline_at" is null))
);
--> statement-breakpoint
CREATE TABLE "workflow_step_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_run_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"status" text NOT NULL,
	"agent_execution_id" uuid,
	"output" jsonb,
	"failure_reason" text,
	"deadline_kind" text,
	"deadline_at" timestamp with time zone,
	"idle_deadline_at" timestamp with time zone,
	"dispatch_intent" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "workflow_step_runs_status_check" CHECK ("workflow_step_runs"."status" in ('pending', 'running', 'succeeded', 'skipped', 'failed', 'timed_out')),
	CONSTRAINT "workflow_step_runs_deadline_kind_check" CHECK ("workflow_step_runs"."deadline_kind" is null or "workflow_step_runs"."deadline_kind" in ('step_hard', 'step_idle', 'whole_run'))
);
--> statement-breakpoint
CREATE TABLE "workflow_wakeups" (
	"trigger_run_id" uuid PRIMARY KEY NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"lease_expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_executions" DROP CONSTRAINT "agent_executions_trigger_project_organization_fk";
--> statement-breakpoint
ALTER TABLE "attachment_capabilities" DROP CONSTRAINT "attachment_capabilities_trigger_id_triggers_id_fk";
--> statement-breakpoint
DROP INDEX "attachment_capabilities_trigger_provider_source_unique";--> statement-breakpoint
DROP INDEX "attachment_capabilities_trigger_idx";--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "workflow_step_run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "hub_action_ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "hub_action_acknowledgements" jsonb DEFAULT '{"terminal_at":null,"idle_at":null,"finish_execution_call":null}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment_capabilities" ADD COLUMN "provider_event_receipt_id" uuid;--> statement-breakpoint
UPDATE "attachment_capabilities" AS "attachment"
SET "provider_event_receipt_id" = "trigger"."receipt_id"
FROM "triggers" AS "trigger"
WHERE "attachment"."trigger_id" = "trigger"."id";--> statement-breakpoint
-- Destructive cutover disposition: legacy executions cannot express workflow-step ownership and are deleted.
DELETE FROM "agent_executions";--> statement-breakpoint
ALTER TABLE "triggers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "triggers" CASCADE;--> statement-breakpoint
ALTER TABLE "attachment_capabilities" ALTER COLUMN "provider_event_receipt_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trigger_runs" ADD CONSTRAINT "trigger_runs_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_runs" ADD CONSTRAINT "trigger_runs_project_organization_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_runs" ADD CONSTRAINT "trigger_runs_revision_project_organization_fk" FOREIGN KEY ("configuration_revision_id","project_id","organization_id") REFERENCES "public"."project_configuration_revisions"("id","project_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_runs" ADD CONSTRAINT "trigger_runs_receipt_organization_fk" FOREIGN KEY ("provider_event_receipt_id","organization_id") REFERENCES "public"."provider_event_receipts"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_trigger_run_fk" FOREIGN KEY ("trigger_run_id") REFERENCES "public"."trigger_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_wakeups" ADD CONSTRAINT "workflow_wakeups_trigger_run_fk" FOREIGN KEY ("trigger_run_id") REFERENCES "public"."trigger_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_runs_receipt_project_configured_unique" ON "trigger_runs" USING btree ("provider_event_receipt_id","project_id","configured_trigger_name");--> statement-breakpoint
CREATE INDEX "trigger_runs_status_deadline_idx" ON "trigger_runs" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE INDEX "trigger_runs_project_created_idx" ON "trigger_runs" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_step_runs_trigger_ordinal_unique" ON "workflow_step_runs" USING btree ("trigger_run_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_step_runs_trigger_step_unique" ON "workflow_step_runs" USING btree ("trigger_run_id","step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_step_runs_agent_execution_unique" ON "workflow_step_runs" USING btree ("agent_execution_id") WHERE "workflow_step_runs"."agent_execution_id" is not null;--> statement-breakpoint
CREATE INDEX "workflow_step_runs_trigger_status_idx" ON "workflow_step_runs" USING btree ("trigger_run_id","status");--> statement-breakpoint
CREATE INDEX "workflow_wakeups_available_lease_idx" ON "workflow_wakeups" USING btree ("available_at","lease_expires_at");--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_workflow_step_run_fk" FOREIGN KEY ("workflow_step_run_id") REFERENCES "public"."workflow_step_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_capabilities" ADD CONSTRAINT "attachment_capabilities_receipt_organization_fk" FOREIGN KEY ("provider_event_receipt_id","organization_id") REFERENCES "public"."provider_event_receipts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_capabilities_receipt_provider_source_unique" ON "attachment_capabilities" USING btree ("provider_event_receipt_id","provider","source_id");--> statement-breakpoint
CREATE INDEX "attachment_capabilities_receipt_idx" ON "attachment_capabilities" USING btree ("provider_event_receipt_id");--> statement-breakpoint
ALTER TABLE "agent_executions" DROP COLUMN "trigger_id";--> statement-breakpoint
ALTER TABLE "agent_executions" DROP COLUMN "trigger_connection_id";--> statement-breakpoint
ALTER TABLE "agent_executions" DROP COLUMN "trigger_resource_id";--> statement-breakpoint
ALTER TABLE "attachment_capabilities" DROP COLUMN "trigger_id";
