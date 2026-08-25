ALTER TABLE "daemon_device_authorizations" RENAME COLUMN "suggested_display_name" TO "suggested_slug";--> statement-breakpoint
ALTER TABLE "daemon_device_authorizations" RENAME COLUMN "approved_display_name" TO "approved_slug";--> statement-breakpoint
ALTER TABLE "daemon_enrollment_tokens" RENAME COLUMN "display_name" TO "slug";--> statement-breakpoint
WITH candidates AS (
	SELECT daemon.id,
		trim(both '-' from regexp_replace(lower(daemon.display_name), '[^a-z0-9]+', '-', 'g')) AS slug
	FROM daemons daemon
	WHERE daemon.display_name IS NOT NULL
		AND daemon.display_name !~ '[^\x00-\x7F]'
), safe_candidates AS (
	SELECT candidate.id, candidate.slug
	FROM candidates candidate
	JOIN daemons daemon ON daemon.id = candidate.id
	WHERE candidate.slug <> ''
		AND length(candidate.slug) <= 72
		AND NOT EXISTS (
			SELECT 1 FROM daemons occupied
			WHERE occupied.organization_id = daemon.organization_id
				AND occupied.id <> daemon.id
				AND occupied.slug = candidate.slug
		)
		AND NOT EXISTS (
			SELECT 1
			FROM candidates duplicate
			JOIN daemons duplicate_daemon ON duplicate_daemon.id = duplicate.id
			WHERE duplicate_daemon.organization_id = daemon.organization_id
				AND duplicate.id <> candidate.id
				AND duplicate.slug = candidate.slug
		)
)
UPDATE daemons daemon
SET slug = candidate.slug
FROM safe_candidates candidate
WHERE daemon.id = candidate.id;--> statement-breakpoint
ALTER TABLE "daemons" DROP COLUMN "display_name";
