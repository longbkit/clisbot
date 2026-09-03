ALTER TABLE "access_assignments" DROP CONSTRAINT "access_assignments_resource_kind_check";--> statement-breakpoint
UPDATE "access_assignments" SET "resource_kind" = 'channel_account' WHERE "resource_kind" = 'channel';--> statement-breakpoint
ALTER TABLE "access_assignments" ADD CONSTRAINT "access_assignments_resource_kind_check" CHECK ("access_assignments"."resource_kind" in ('organization', 'daemon', 'project', 'channel_account', 'automation'));
