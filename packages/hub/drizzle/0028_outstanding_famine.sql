CREATE TABLE "billing_plan_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"lookup_key" text NOT NULL,
	"interval" text NOT NULL,
	"unit_amount" integer NOT NULL,
	"currency" text NOT NULL,
	"active" boolean NOT NULL,
	CONSTRAINT "billing_plan_prices_interval_check" CHECK ("billing_plan_prices"."interval" in ('monthly', 'annual'))
);
--> statement-breakpoint
CREATE TABLE "billing_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"template" jsonb NOT NULL,
	"template_hash" text NOT NULL,
	"marketing" jsonb NOT NULL,
	"active" boolean NOT NULL,
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_plan_prices" ADD CONSTRAINT "billing_plan_prices_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_plan_prices_plan_id_idx" ON "billing_plan_prices" USING btree ("plan_id");