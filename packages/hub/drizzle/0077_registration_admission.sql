CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_email_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_email_domains_lowercase_check" CHECK ("organization_email_domains"."domain" = lower("organization_email_domains"."domain"))
);
--> statement-breakpoint
CREATE TABLE "pending_registrations" (
	"email" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_registrations_lowercase_check" CHECK ("pending_registrations"."email" = lower("pending_registrations"."email"))
);
--> statement-breakpoint
ALTER TABLE "organization_email_domains" ADD CONSTRAINT "organization_email_domains_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_unique" ON "email_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_email_created_idx" ON "email_verification_tokens" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "organization_email_domains_organization_id_idx" ON "organization_email_domains" USING btree ("organization_id");