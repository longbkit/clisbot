ALTER TABLE "triggers" ADD COLUMN "signature_hash" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "triggers_signature_hash_unique" ON "triggers" USING btree ("signature_hash") WHERE "signature_hash" IS NOT NULL;
