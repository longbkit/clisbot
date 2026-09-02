CREATE TABLE "teamMember" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "team_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_team_id" text;--> statement-breakpoint
ALTER TABLE "teamMember" ADD CONSTRAINT "teamMember_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teamMember" ADD CONSTRAINT "teamMember_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_unique" ON "teamMember" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_members_user_id_idx" ON "teamMember" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "teams_organization_id_idx" ON "team" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_active_team_id_idx" ON "session" USING btree ("active_team_id");