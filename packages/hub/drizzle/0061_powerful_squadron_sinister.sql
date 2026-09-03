CREATE TABLE "channel_identity_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_verifier" text NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_identity_challenges_token_verifier_unique" UNIQUE("token_verifier")
);
--> statement-breakpoint
ALTER TABLE "channel_identity_challenges" ADD CONSTRAINT "channel_identity_challenges_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_identity_challenges" ADD CONSTRAINT "channel_identity_challenges_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_identity_challenges_member_connection_idx" ON "channel_identity_challenges" USING btree ("organization_id","member_id","connection_id");--> statement-breakpoint
CREATE INDEX "channel_identity_challenges_expiry_idx" ON "channel_identity_challenges" USING btree ("expires_at");