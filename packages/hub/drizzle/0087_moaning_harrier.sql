CREATE TABLE "device_authority" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"state" jsonb NOT NULL,
	"personal_user_id" text,
	"personal_organization_id" text,
	CONSTRAINT "device_authority_singleton_check" CHECK ("device_authority"."singleton")
);
--> statement-breakpoint
ALTER TABLE "device_authority" ADD CONSTRAINT "device_authority_personal_user_id_user_id_fk" FOREIGN KEY ("personal_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_authority" ADD CONSTRAINT "device_authority_personal_organization_id_organization_id_fk" FOREIGN KEY ("personal_organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;