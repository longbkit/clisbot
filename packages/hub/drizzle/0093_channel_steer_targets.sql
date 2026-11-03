CREATE TABLE "channel_steer_targets" (
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"message_id" text NOT NULL,
	"turn_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_steer_targets_pk" PRIMARY KEY("organization_id","agent_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "channel_steer_targets" ADD CONSTRAINT "channel_steer_targets_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_steer_targets_created_idx" ON "channel_steer_targets" USING btree ("organization_id","created_at");