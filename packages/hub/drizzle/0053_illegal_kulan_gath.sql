ALTER TABLE "project_trigger_migrations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "project_trigger_migrations" CASCADE;--> statement-breakpoint
ALTER TABLE "organization_trigger_revisions" DROP CONSTRAINT "organization_trigger_revisions_source_kind_check";--> statement-breakpoint
ALTER TABLE "agent_executions" DROP CONSTRAINT "agent_executions_project_organization_fk";
--> statement-breakpoint
ALTER TABLE "agent_executions" DROP CONSTRAINT "agent_executions_revision_project_organization_fk";
--> statement-breakpoint
ALTER TABLE "organization_triggers" DROP CONSTRAINT "organization_triggers_runtime_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "trigger_runs" DROP CONSTRAINT "trigger_runs_project_organization_fk";
--> statement-breakpoint
ALTER TABLE "trigger_runs" DROP CONSTRAINT "trigger_runs_revision_project_organization_fk";
--> statement-breakpoint
DROP INDEX "agent_executions_project_started_at_idx";--> statement-breakpoint
DROP INDEX "trigger_runs_receipt_project_configured_unique";--> statement-breakpoint
DROP INDEX "trigger_runs_project_created_idx";--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "workflow_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "trigger_runs" ADD COLUMN "workflow_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_revision_workflow_organization_fk" FOREIGN KEY ("configuration_revision_id","workflow_id","organization_id") REFERENCES "public"."organization_trigger_revisions"("id","trigger_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_runs" ADD CONSTRAINT "trigger_runs_revision_workflow_organization_fk" FOREIGN KEY ("configuration_revision_id","workflow_id","organization_id") REFERENCES "public"."organization_trigger_revisions"("id","trigger_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_executions_workflow_started_at_idx" ON "agent_executions" USING btree ("workflow_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "trigger_runs_receipt_workflow_unique" ON "trigger_runs" USING btree ("provider_event_receipt_id","workflow_id");--> statement-breakpoint
CREATE INDEX "trigger_runs_workflow_created_idx" ON "trigger_runs" USING btree ("workflow_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "agent_executions" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "organization_triggers" DROP COLUMN "runtime_project_id";--> statement-breakpoint
ALTER TABLE "trigger_runs" DROP COLUMN "project_id";--> statement-breakpoint
ALTER TABLE "organization_trigger_revisions" ADD CONSTRAINT "organization_trigger_revisions_source_kind_check" CHECK ("organization_trigger_revisions"."source_kind" in ('manual', 'github'));