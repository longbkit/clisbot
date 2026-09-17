CREATE TABLE "invitation_teams" (
	"invitation_id" text NOT NULL,
	"team_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_teams_invitation_team_pk" PRIMARY KEY("invitation_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "invitation_teams" ADD CONSTRAINT "invitation_teams_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_teams" ADD CONSTRAINT "invitation_teams_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_teams_team_id_idx" ON "invitation_teams" USING btree ("team_id");--> statement-breakpoint
INSERT INTO "invitation_teams" ("invitation_id", "team_id")
SELECT "id", "team_id" FROM "invitation" WHERE "team_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_team_id_team_id_fk";--> statement-breakpoint
ALTER TABLE "invitation" DROP COLUMN "team_id";