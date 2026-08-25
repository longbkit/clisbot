DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "member"
    GROUP BY "organization_id", "user_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'phase 1 migration blocked: duplicate organization memberships exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "invitation"
    WHERE "status" = 'pending'
    GROUP BY "organization_id", lower("email")
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'phase 1 migration blocked: duplicate normalized pending invitations exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "invitation"
    JOIN "user" ON lower("user"."email") = lower("invitation"."email")
    JOIN "member" ON "member"."user_id" = "user"."id"
      AND "member"."organization_id" = "invitation"."organization_id"
    WHERE "invitation"."status" = 'pending'
  ) THEN
    RAISE EXCEPTION 'phase 1 migration blocked: pending invitation exists for current organization member';
  END IF;

  IF EXISTS (SELECT 1 FROM "member" WHERE "role" NOT IN ('owner', 'admin', 'member')) THEN
    RAISE EXCEPTION 'phase 1 migration blocked: unknown or multi-valued member role exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "invitation"
    WHERE "role" IS NULL OR "role" NOT IN ('admin', 'member')
  ) THEN
    RAISE EXCEPTION 'phase 1 migration blocked: unknown or missing invitation role exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "invitation"
    WHERE "status" NOT IN ('pending', 'accepted', 'rejected', 'canceled')
  ) THEN
    RAISE EXCEPTION 'phase 1 migration blocked: unknown invitation status exists';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
UPDATE "invitation" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "invitations_organization_status_idx" ON "invitation" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_organization_email_unique" ON "invitation" USING btree ("organization_id",lower("email")) WHERE "invitation"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "members_organization_user_unique" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "members_user_id_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "members_organization_id_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sessions_active_organization_id_idx" ON "session" USING btree ("active_organization_id");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitations_role_check" CHECK ("invitation"."role" in ('admin', 'member'));--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitations_status_check" CHECK ("invitation"."status" in ('pending', 'accepted', 'rejected', 'canceled'));--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "members_role_check" CHECK ("member"."role" in ('owner', 'admin', 'member'));
