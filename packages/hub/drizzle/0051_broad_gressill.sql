CREATE TABLE "workflow_agent_reuse_bindings" (
	"organization_id" text NOT NULL,
	"binding_key" text NOT NULL,
	"workflow_name" text NOT NULL,
	"step_id" text NOT NULL,
	"agent_execution_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_agent_reuse_bindings_pk" PRIMARY KEY("organization_id","binding_key","workflow_name","step_id")
);
--> statement-breakpoint
ALTER TABLE "provider_event_receipts" DROP CONSTRAINT "provider_event_receipts_provider_check";--> statement-breakpoint
ALTER TABLE "workflow_agent_reuse_bindings" ADD CONSTRAINT "workflow_agent_reuse_bindings_agent_execution_id_agent_executions_id_fk" FOREIGN KEY ("agent_execution_id") REFERENCES "public"."agent_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_agent_reuse_bindings_execution_idx" ON "workflow_agent_reuse_bindings" USING btree ("agent_execution_id");--> statement-breakpoint
ALTER TABLE "provider_event_receipts" ADD CONSTRAINT "provider_event_receipts_provider_check" CHECK ("provider_event_receipts"."provider" in ('github', 'slack', 'discord', 'linear', 'manual', 'channel'));