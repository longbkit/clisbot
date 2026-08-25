DO $$ BEGIN
  ALTER TABLE "daemons" ADD CONSTRAINT "daemons_status_check" CHECK ("daemons"."status" in ('active', 'revoked'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "daemons" ADD CONSTRAINT "daemons_presence_check" CHECK ("daemons"."presence" in ('offline', 'connected'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
