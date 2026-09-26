-- docs/features/access/terminal-and-project-creation.md
-- 1. Can share stops being implied by workspace.manage: write it where it was only implied.
UPDATE "access_assignments"
SET "privileges" = "privileges" || '["hub.access.manage"]'::jsonb, "updated_at" = now()
WHERE "resource_kind" IN ('daemon', 'project')
  AND "privileges" ? 'workspace.manage'
  AND NOT "privileges" ? 'hub.access.manage';--> statement-breakpoint
-- 2. Every grant that opened a shell may also launch every Terminal profile.
UPDATE "access_assignments"
SET "privileges" = "privileges" || '["terminal.profile.use"]'::jsonb,
    "constraints" = "constraints" || '{"terminalProfiles": "*"}'::jsonb,
    "updated_at" = now()
WHERE "resource_kind" IN ('daemon', 'project')
  AND "privileges" ? 'terminal.use'
  AND NOT "privileges" ? 'terminal.profile.use';--> statement-breakpoint
-- 3. Developer loses the shell: grants that open a shell without managing Projects.
UPDATE "access_assignments"
SET "privileges" = "privileges" - 'terminal.use', "updated_at" = now()
WHERE "resource_kind" IN ('daemon', 'project')
  AND "privileges" ? 'terminal.use'
  AND NOT "privileges" ? 'workspace.manage'
  AND NOT "privileges" ? 'daemon.manage';
