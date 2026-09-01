ALTER TABLE "organization_subscriptions" RENAME TO "organization_billing_customers";--> statement-breakpoint
ALTER TABLE "organization_billing_customers" DROP CONSTRAINT "organization_subscriptions_stripe_subscription_id_unique";--> statement-breakpoint
ALTER TABLE "organization_billing_customers" DROP CONSTRAINT "organization_subscriptions_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "organization_billing_customers" ADD CONSTRAINT "organization_billing_customers_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_billing_customers" DROP COLUMN "stripe_subscription_id";--> statement-breakpoint
ALTER TABLE "organization_billing_customers" DROP COLUMN "plan_id";--> statement-breakpoint
ALTER TABLE "organization_billing_customers" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "organization_billing_customers" DROP COLUMN "current_period_end";--> statement-breakpoint
ALTER TABLE "organization_billing_customers" DROP COLUMN "cancel_at_period_end";