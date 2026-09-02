ALTER TABLE "slack_connections" DROP CONSTRAINT "slack_connections_team_id_unique";--> statement-breakpoint
ALTER TABLE "runtime_provider_activation" DROP CONSTRAINT "runtime_provider_activation_pkey";--> statement-breakpoint
ALTER TABLE "runtime_provider_configuration" DROP CONSTRAINT "runtime_provider_configuration_pkey";--> statement-breakpoint
ALTER TABLE "slack_connections" ALTER COLUMN "provider_application_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_provider_configuration" ADD COLUMN "provider_application_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_provider_activation" ADD CONSTRAINT "runtime_provider_activation_provider_application_pk" PRIMARY KEY("provider","provider_application_id");--> statement-breakpoint
ALTER TABLE "runtime_provider_configuration" ADD CONSTRAINT "runtime_provider_configuration_provider_application_pk" PRIMARY KEY("provider","provider_application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_connections_application_team_unique" ON "slack_connections" USING btree ("provider_application_id","team_id");
