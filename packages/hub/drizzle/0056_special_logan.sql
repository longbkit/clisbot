CREATE TABLE "access_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"privileges" jsonb NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_assignments_subject_kind_check" CHECK ("access_assignments"."subject_kind" in ('member', 'team')),
	CONSTRAINT "access_assignments_resource_kind_check" CHECK ("access_assignments"."resource_kind" in ('organization', 'daemon', 'project', 'channel', 'automation'))
);
--> statement-breakpoint
CREATE TABLE "channel_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"external_subject_id" text NOT NULL,
	"display_name" text,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daemon_access_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"daemon_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"client_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daemon_access_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_verifier" text NOT NULL,
	"organization_id" text NOT NULL,
	"daemon_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"client_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daemon_access_tickets_token_verifier_unique" UNIQUE("token_verifier")
);
--> statement-breakpoint
CREATE TABLE "daemon_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"daemon_id" uuid NOT NULL,
	"external_project_id" text NOT NULL,
	"name" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_assignments" ADD CONSTRAINT "access_assignments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_assignments" ADD CONSTRAINT "access_assignments_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_access_leases" ADD CONSTRAINT "daemon_access_leases_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_access_leases" ADD CONSTRAINT "daemon_access_leases_daemon_id_daemons_id_fk" FOREIGN KEY ("daemon_id") REFERENCES "public"."daemons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_access_leases" ADD CONSTRAINT "daemon_access_leases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_access_leases" ADD CONSTRAINT "daemon_access_leases_membership_id_member_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_access_tickets" ADD CONSTRAINT "daemon_access_tickets_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_access_tickets" ADD CONSTRAINT "daemon_access_tickets_daemon_id_daemons_id_fk" FOREIGN KEY ("daemon_id") REFERENCES "public"."daemons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_access_tickets" ADD CONSTRAINT "daemon_access_tickets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_access_tickets" ADD CONSTRAINT "daemon_access_tickets_membership_id_member_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daemon_projects" ADD CONSTRAINT "daemon_projects_daemon_organization_fk" FOREIGN KEY ("daemon_id","organization_id") REFERENCES "public"."daemons"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_assignments_subject_resource_unique" ON "access_assignments" USING btree ("organization_id","subject_kind","subject_id","resource_kind","resource_id");--> statement-breakpoint
CREATE INDEX "access_assignments_resource_idx" ON "access_assignments" USING btree ("organization_id","resource_kind","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_identities_connection_subject_unique" ON "channel_identities" USING btree ("organization_id","connection_id","external_subject_id");--> statement-breakpoint
CREATE INDEX "channel_identities_member_idx" ON "channel_identities" USING btree ("organization_id","member_id");--> statement-breakpoint
CREATE INDEX "daemon_access_leases_member_idx" ON "daemon_access_leases" USING btree ("organization_id","membership_id");--> statement-breakpoint
CREATE INDEX "daemon_access_leases_daemon_expiry_idx" ON "daemon_access_leases" USING btree ("daemon_id","expires_at");--> statement-breakpoint
CREATE INDEX "daemon_access_tickets_expiry_idx" ON "daemon_access_tickets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "daemon_access_tickets_member_daemon_idx" ON "daemon_access_tickets" USING btree ("membership_id","daemon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daemon_projects_daemon_external_unique" ON "daemon_projects" USING btree ("daemon_id","external_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daemon_projects_id_organization_unique" ON "daemon_projects" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "daemon_projects_organization_available_idx" ON "daemon_projects" USING btree ("organization_id","available");