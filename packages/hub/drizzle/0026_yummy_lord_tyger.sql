CREATE TABLE "organization_usage" (
	"organization_id" text NOT NULL,
	"meter" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "organization_usage_organization_id_meter_period_start_pk" PRIMARY KEY("organization_id","meter","period_start")
);
--> statement-breakpoint
ALTER TABLE "organization_usage" ADD CONSTRAINT "organization_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_usage_organization_meter_idx" ON "organization_usage" USING btree ("organization_id","meter");