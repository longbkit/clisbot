CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"actor_kind" text NOT NULL,
	"actor_identity" text NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_actor_kind_check" CHECK ("audit_events"."actor_kind" in ('user', 'github', 'system'))
);
--> statement-breakpoint
CREATE TABLE "configuration_sync_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"repository_assignment_id" uuid,
	"webhook_delivery_id" text,
	"commit_sha" text,
	"outcome" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"guild_name" text NOT NULL,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_connections_guild_id_unique" UNIQUE("guild_id")
);
--> statement-breakpoint
CREATE TABLE "github_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"status" text NOT NULL,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_at" timestamp with time zone,
	CONSTRAINT "github_connections_installation_id_unique" UNIQUE("installation_id"),
	CONSTRAINT "github_connections_status_check" CHECK ("github_connections"."status" in ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "project_configuration_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"version" integer NOT NULL,
	"source_kind" text NOT NULL,
	"source_evidence" jsonb NOT NULL,
	"raw_yaml" text,
	"normalized_configuration" jsonb NOT NULL,
	"validation_errors" jsonb,
	"content_hash" text NOT NULL,
	"github_repository_id" bigint,
	"github_repository_full_name" text,
	"github_commit_sha" text,
	"github_commit_url" text,
	"github_ref" text,
	"github_webhook_delivery_id" text,
	"github_sender" text,
	"github_author" text,
	"github_committer" text,
	"created_by_user_id" text,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_at" timestamp with time zone,
	CONSTRAINT "project_configuration_revisions_source_kind_check" CHECK ("project_configuration_revisions"."source_kind" in ('github', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "project_configuration_sources" (
	"organization_id" text NOT NULL,
	"project_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"repository_assignment_id" uuid,
	"automatic_deployment_enabled" boolean DEFAULT false NOT NULL,
	"selected_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_daemons" (
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"daemon_id" uuid NOT NULL,
	"assigned_by_user_id" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_daemons_project_id_daemon_id_pk" PRIMARY KEY("project_id","daemon_id")
);
--> statement-breakpoint
CREATE TABLE "project_discord_connections" (
	"organization_id" text NOT NULL,
	"project_id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"attached_by_user_id" text,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_discord_connections_connection_id_unique" UNIQUE("connection_id")
);
--> statement-breakpoint
CREATE TABLE "project_github_connections" (
	"organization_id" text NOT NULL,
	"project_id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"attached_by_user_id" text,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_github_repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"repository_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"assigned_by_user_id" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_slack_connections" (
	"organization_id" text NOT NULL,
	"project_id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"attached_by_user_id" text,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_slack_connections_connection_id_unique" UNIQUE("connection_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"active_configuration_revision_id" uuid,
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('active', 'archived')),
	CONSTRAINT "projects_archive_shape_check" CHECK (("projects"."status" = 'active' and "projects"."archived_at" is null) or ("projects"."status" = 'archived' and "projects"."archived_at" is not null and "projects"."active_configuration_revision_id" is null))
);
--> statement-breakpoint
CREATE TABLE "slack_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"bot_access_token" text NOT NULL,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_connections_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
ALTER TABLE "triggers" DROP CONSTRAINT "triggers_organization_or_dropped_check";--> statement-breakpoint
ALTER TABLE "agent_executions" DROP CONSTRAINT IF EXISTS "agent_executions_machine_id_machines_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_executions" DROP CONSTRAINT IF EXISTS "agent_executions_hub_config_version_id_hub_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_executions" DROP CONSTRAINT IF EXISTS "agent_executions_daemon_id_daemons_id_fk";
--> statement-breakpoint
ALTER TABLE "machines" DROP CONSTRAINT IF EXISTS "machines_hub_config_version_id_hub_configs_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "configuration_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD COLUMN "target_project_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD COLUMN "return_route" text;--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "configuration_revision_id" uuid;--> statement-breakpoint

-- The cutover is deliberately direct: every existing organization receives exactly one
-- Default project, all durable rows are moved to it, and the old model is removed below.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM hub_configs
    WHERE is_current
    GROUP BY org_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'projects cutover requires at most one active hub configuration per organization';
  END IF;
END $$;--> statement-breakpoint

-- Phase 0 allowed a machine to retain the bootstrap organization even when every durable
-- execution proved that it served another organization. Move only unclaimed historical
-- machines with one unambiguous execution owner; active daemon ownership remains untouched.
UPDATE machines machine
SET org_id = ownership.organization_id
FROM (
  SELECT evidence.machine_id, min(evidence.organization_id) organization_id
  FROM (
    SELECT execution.machine_id, hub.org_id organization_id
    FROM agent_executions execution
    JOIN hub_configs hub ON hub.id = execution.hub_config_version_id
    WHERE execution.machine_id IS NOT NULL
    UNION ALL
    SELECT machine.id, hub.org_id
    FROM machines machine
    JOIN hub_configs hub ON hub.id = machine.hub_config_version_id
  ) evidence
  GROUP BY evidence.machine_id
  HAVING count(DISTINCT evidence.organization_id) = 1
) ownership
WHERE machine.id = ownership.machine_id
  AND machine.org_id IS DISTINCT FROM ownership.organization_id
  AND NOT EXISTS (SELECT 1 FROM daemons daemon WHERE daemon.machine_id = machine.id);--> statement-breakpoint

INSERT INTO projects (organization_id, name, slug, created_by_user_id, created_at, updated_at)
SELECT organization.id, 'Default', 'default', (
  SELECT member.user_id
  FROM member
  WHERE member.organization_id = organization.id
  ORDER BY CASE member.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, member.created_at
  LIMIT 1
), organization.created_at, clock_timestamp()
FROM organization;--> statement-breakpoint

INSERT INTO project_daemons (organization_id, project_id, daemon_id, assigned_by_user_id, assigned_at)
SELECT daemon.organization_id, project.id, daemon.id, daemon.approved_by_user_id, daemon.created_at
FROM daemons daemon
JOIN projects project ON project.organization_id = daemon.organization_id AND project.slug = 'default';--> statement-breakpoint

INSERT INTO project_configuration_revisions (
  id, project_id, organization_id, version, source_kind, source_evidence, raw_yaml,
  normalized_configuration, validation_errors, content_hash, created_at, validated_at
)
SELECT hub.id, project.id, hub.org_id,
  row_number() OVER (PARTITION BY hub.org_id ORDER BY hub.created_at, hub.id)::integer,
  CASE WHEN hub.source->>'type' = 'github' THEN 'github' ELSE 'manual' END,
  jsonb_build_object(
    'legacyName', hub.name,
    'legacyVersion', hub.version,
    'legacySource', hub.source,
    'legacyRepositoryNames', COALESCE(hub.config->'indexes'->'github', '[]'::jsonb),
    'rawYamlAvailable', false,
    'formattingPreserved', false
  ),
  NULL,
  hub.config - 'indexes',
  hub.errors,
  md5((hub.config - 'indexes')::text),
  hub.created_at,
  CASE WHEN hub.errors IS NULL THEN hub.created_at ELSE NULL END
FROM hub_configs hub
JOIN projects project ON project.organization_id = hub.org_id AND project.slug = 'default';--> statement-breakpoint

-- Compile authored daemon slugs to immutable IDs while retaining the authored `daemon`
-- field. Historical revisions may name retired daemons; only an active revision must
-- resolve every daemon before the cutover can keep it active.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM project_configuration_revisions revision
    JOIN hub_configs hub ON hub.id = revision.id AND hub.is_current
    CROSS JOIN LATERAL jsonb_array_elements(revision.normalized_configuration->'environments') environment
    WHERE environment->>'kind' = 'daemon'
      AND NOT EXISTS (
        SELECT 1
        FROM project_daemons assignment
        JOIN daemons daemon ON daemon.id = assignment.daemon_id AND daemon.organization_id = assignment.organization_id
        WHERE assignment.project_id = revision.project_id
          AND assignment.organization_id = revision.organization_id
          AND daemon.slug = environment->>'daemon'
      )
  ) THEN
    RAISE EXCEPTION 'projects cutover found an unassigned daemon reference in an active configuration revision';
  END IF;
END $$;--> statement-breakpoint

UPDATE project_configuration_revisions revision
SET normalized_configuration = jsonb_set(
  revision.normalized_configuration,
  '{environments}',
  COALESCE((
    SELECT jsonb_agg(
      CASE WHEN environment->>'kind' = 'daemon' AND daemon.id IS NOT NULL
        THEN environment || jsonb_build_object('daemonId', daemon.id)
        ELSE environment
      END ORDER BY ordinal
    )
    FROM jsonb_array_elements(revision.normalized_configuration->'environments') WITH ORDINALITY AS item(environment, ordinal)
    LEFT JOIN daemons daemon
      ON daemon.organization_id = revision.organization_id
      AND daemon.slug = environment->>'daemon'
      AND EXISTS (
        SELECT 1 FROM project_daemons assignment
        WHERE assignment.project_id = revision.project_id AND assignment.daemon_id = daemon.id
      )
  ), '[]'::jsonb)
);--> statement-breakpoint

UPDATE projects project
SET active_configuration_revision_id = hub.id
FROM hub_configs hub
WHERE hub.org_id = project.organization_id AND hub.is_current AND project.slug = 'default';--> statement-breakpoint

INSERT INTO github_connections (
  organization_id, installation_id, account_id, account_login, account_type, status,
  connected_by_user_id, connected_at, updated_at, suspended_at
)
SELECT organization_id, installation_id, account_id, account_login, account_type, status,
  connected_by_user_id, connected_at, updated_at, suspended_at
FROM github_installation_bindings;--> statement-breakpoint

INSERT INTO discord_connections (
  organization_id, guild_id, guild_name, connected_by_user_id, connected_at, updated_at
)
SELECT organization_id, guild_id, guild_name, connected_by_user_id, connected_at, updated_at
FROM discord_guild_bindings;--> statement-breakpoint

INSERT INTO slack_connections (
  organization_id, team_id, team_name, bot_user_id, bot_access_token,
  connected_by_user_id, connected_at, updated_at
)
SELECT organization_id, team_id, team_name, bot_user_id, bot_access_token,
  connected_by_user_id, connected_at, updated_at
FROM slack_workspace_bindings;--> statement-breakpoint

INSERT INTO project_github_connections (organization_id, project_id, connection_id, attached_by_user_id, attached_at)
SELECT connection.organization_id, project.id, connection.id, connection.connected_by_user_id, connection.connected_at
FROM github_connections connection
JOIN projects project ON project.organization_id = connection.organization_id AND project.slug = 'default';--> statement-breakpoint

INSERT INTO project_discord_connections (organization_id, project_id, connection_id, attached_by_user_id, attached_at)
SELECT connection.organization_id, project.id, connection.id, connection.connected_by_user_id, connection.connected_at
FROM discord_connections connection
JOIN projects project ON project.organization_id = connection.organization_id AND project.slug = 'default';--> statement-breakpoint

INSERT INTO project_slack_connections (organization_id, project_id, connection_id, attached_by_user_id, attached_at)
SELECT connection.organization_id, project.id, connection.id, connection.connected_by_user_id, connection.connected_at
FROM slack_connections connection
JOIN projects project ON project.organization_id = connection.organization_id AND project.slug = 'default';--> statement-breakpoint

-- Legacy configuration indexes contain mutable repository names, not the immutable IDs
-- required by project routing. Preserve those names in revision evidence and require an
-- explicit post-cutover repository assignment rather than manufacturing authority.
INSERT INTO project_configuration_sources (
  organization_id, project_id, kind, repository_assignment_id, selected_by_user_id
)
SELECT project.organization_id, project.id, 'manual', NULL, project.created_by_user_id
FROM projects project;--> statement-breakpoint

UPDATE organization_connection_attempts attempt
SET return_route = '/o/' || organization.slug || '/connections'
FROM organization
WHERE organization.id = attempt.organization_id;--> statement-breakpoint

UPDATE triggers trigger
SET project_id = project.id
FROM projects project
WHERE project.organization_id = trigger.organization_id AND project.slug = 'default';--> statement-breakpoint

UPDATE agent_executions execution
SET organization_id = hub.org_id,
    project_id = project.id,
    configuration_revision_id = hub.id
FROM hub_configs hub
JOIN projects project ON project.organization_id = hub.org_id AND project.slug = 'default'
WHERE hub.id = execution.hub_config_version_id;--> statement-breakpoint

-- Never destroy recovery authority for an inconsistent live execution. Historical terminal
-- rows can keep their execution/configuration evidence without an unprovable resource link.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM agent_executions execution
    LEFT JOIN machines machine ON machine.id = execution.machine_id
    LEFT JOIN daemons daemon ON daemon.id = execution.daemon_id
    WHERE execution.status IN ('spawning', 'running')
      AND (
        (execution.machine_id IS NOT NULL AND machine.org_id IS DISTINCT FROM execution.organization_id)
        OR (execution.daemon_id IS NOT NULL AND daemon.organization_id IS DISTINCT FROM execution.organization_id)
      )
  ) THEN
    RAISE EXCEPTION 'projects cutover found inconsistent live execution resource ownership';
  END IF;
END $$;--> statement-breakpoint

UPDATE agent_executions execution
SET machine_id = NULL
FROM machines machine
WHERE machine.id = execution.machine_id
  AND execution.status IN ('succeeded', 'failed')
  AND machine.org_id IS DISTINCT FROM execution.organization_id;--> statement-breakpoint

UPDATE agent_executions execution
SET daemon_id = NULL
FROM daemons daemon
WHERE daemon.id = execution.daemon_id
  AND execution.status IN ('succeeded', 'failed')
  AND daemon.organization_id IS DISTINCT FROM execution.organization_id;--> statement-breakpoint

-- Historical trigger links that point at executions in more than one organization cannot
-- truthfully satisfy the new tenant graph. Keep both durable records, but detach that
-- ambiguous association rather than inventing ownership.
UPDATE agent_executions execution
SET trigger_id = NULL
WHERE execution.trigger_id IN (
  SELECT trigger_id
  FROM agent_executions
  WHERE trigger_id IS NOT NULL
  GROUP BY trigger_id
  HAVING count(DISTINCT (organization_id, project_id)) > 1
);--> statement-breakpoint

UPDATE triggers trigger
SET organization_id = execution.organization_id,
    project_id = execution.project_id,
    configuration_revision_id = execution.configuration_revision_id
FROM agent_executions execution
WHERE execution.trigger_id = trigger.id;--> statement-breakpoint

UPDATE triggers trigger
SET configuration_revision_id = project.active_configuration_revision_id
FROM projects project
WHERE project.id = trigger.project_id AND trigger.configuration_revision_id IS NULL;--> statement-breakpoint

ALTER TABLE agent_executions ALTER COLUMN organization_id SET NOT NULL;--> statement-breakpoint
ALTER TABLE agent_executions ALTER COLUMN project_id SET NOT NULL;--> statement-breakpoint
ALTER TABLE agent_executions ALTER COLUMN configuration_revision_id SET NOT NULL;--> statement-breakpoint
ALTER TABLE organization_connection_attempts ALTER COLUMN return_route SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_id_organization_unique" ON "projects" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_configuration_revisions_id_project_organization_unique" ON "project_configuration_revisions" USING btree ("id","project_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daemons_id_organization_unique" ON "daemons" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_connections_id_organization_unique" ON "github_connections" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discord_connections_id_organization_unique" ON "discord_connections" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_connections_id_organization_unique" ON "slack_connections" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_github_connections_project_connection_organization_unique" ON "project_github_connections" USING btree ("project_id","connection_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_github_repositories_id_project_organization_unique" ON "project_github_repositories" USING btree ("id","project_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "triggers_id_project_organization_unique" ON "triggers" USING btree ("id","project_id","organization_id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_organization_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_sync_attempts" ADD CONSTRAINT "configuration_sync_attempts_repository_assignment_id_project_github_repositories_id_fk" FOREIGN KEY ("repository_assignment_id") REFERENCES "public"."project_github_repositories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_sync_attempts" ADD CONSTRAINT "configuration_sync_attempts_project_organization_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_connections" ADD CONSTRAINT "discord_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_connections" ADD CONSTRAINT "discord_connections_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_configuration_revisions" ADD CONSTRAINT "project_configuration_revisions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_configuration_revisions" ADD CONSTRAINT "project_configuration_revisions_project_organization_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_configuration_sources" ADD CONSTRAINT "project_configuration_sources_repository_project_organization_fk" FOREIGN KEY ("repository_assignment_id","project_id","organization_id") REFERENCES "public"."project_github_repositories"("id","project_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_configuration_sources" ADD CONSTRAINT "project_configuration_sources_authority_shape_check" CHECK (("kind" = 'manual' and "repository_assignment_id" is null and not "automatic_deployment_enabled") or ("kind" = 'github' and "repository_assignment_id" is not null));--> statement-breakpoint
ALTER TABLE "project_configuration_sources" ADD CONSTRAINT "project_configuration_sources_selected_by_user_id_user_id_fk" FOREIGN KEY ("selected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_configuration_sources" ADD CONSTRAINT "project_configuration_sources_project_organization_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_daemons" ADD CONSTRAINT "project_daemons_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_daemons" ADD CONSTRAINT "project_daemons_project_organization_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_daemons" ADD CONSTRAINT "project_daemons_daemon_organization_fk" FOREIGN KEY ("daemon_id","organization_id") REFERENCES "public"."daemons"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_discord_connections" ADD CONSTRAINT "project_discord_connections_attached_by_user_id_user_id_fk" FOREIGN KEY ("attached_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_discord_connections" ADD CONSTRAINT "project_discord_connections_project_organization_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_discord_connections" ADD CONSTRAINT "project_discord_connections_connection_organization_fk" FOREIGN KEY ("connection_id","organization_id") REFERENCES "public"."discord_connections"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_github_connections" ADD CONSTRAINT "project_github_connections_attached_by_user_id_user_id_fk" FOREIGN KEY ("attached_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_github_connections" ADD CONSTRAINT "project_github_connections_project_organization_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_github_connections" ADD CONSTRAINT "project_github_connections_connection_organization_fk" FOREIGN KEY ("connection_id","organization_id") REFERENCES "public"."github_connections"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_github_repositories" ADD CONSTRAINT "project_github_repositories_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_github_repositories" ADD CONSTRAINT "project_github_repositories_attachment_fk" FOREIGN KEY ("project_id","connection_id","organization_id") REFERENCES "public"."project_github_connections"("project_id","connection_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_slack_connections" ADD CONSTRAINT "project_slack_connections_attached_by_user_id_user_id_fk" FOREIGN KEY ("attached_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_slack_connections" ADD CONSTRAINT "project_slack_connections_project_organization_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_slack_connections" ADD CONSTRAINT "project_slack_connections_connection_organization_fk" FOREIGN KEY ("connection_id","organization_id") REFERENCES "public"."slack_connections"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_active_configuration_revision_id_project_configuration_revisions_id_fk" FOREIGN KEY ("active_configuration_revision_id") REFERENCES "public"."project_configuration_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_active_revision_project_organization_fk" FOREIGN KEY ("active_configuration_revision_id","id","organization_id") REFERENCES "public"."project_configuration_revisions"("id","project_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_organization_created_idx" ON "audit_events" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_project_created_idx" ON "audit_events" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "configuration_sync_attempts_project_created_idx" ON "configuration_sync_attempts" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "github_connections_installation_unique" ON "github_connections" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "github_connections_organization_idx" ON "github_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_configuration_revisions_project_version_unique" ON "project_configuration_revisions" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "project_configuration_revisions_project_created_idx" ON "project_configuration_revisions" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "project_daemons_daemon_idx" ON "project_daemons" USING btree ("daemon_id");--> statement-breakpoint
CREATE INDEX "project_github_connections_connection_idx" ON "project_github_connections" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_github_repositories_repository_unique" ON "project_github_repositories" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_github_repositories_project_name_unique" ON "project_github_repositories" USING btree ("project_id","full_name");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_organization_slug_unique" ON "projects" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "projects_organization_status_idx" ON "projects" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_project_organization_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_revision_project_organization_fk" FOREIGN KEY ("configuration_revision_id","project_id","organization_id") REFERENCES "public"."project_configuration_revisions"("id","project_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_machine_organization_fk" FOREIGN KEY ("machine_id","organization_id") REFERENCES "public"."machines"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_daemon_organization_fk" FOREIGN KEY ("daemon_id","organization_id") REFERENCES "public"."daemons"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_trigger_project_organization_fk" FOREIGN KEY ("trigger_id","project_id","organization_id") REFERENCES "public"."triggers"("id","project_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_connection_attempts" ADD CONSTRAINT "organization_connection_attempts_project_organization_fk" FOREIGN KEY ("target_project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_project_organization_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."projects"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_revision_project_organization_fk" FOREIGN KEY ("configuration_revision_id","project_id","organization_id") REFERENCES "public"."project_configuration_revisions"("id","project_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_executions_project_started_at_idx" ON "agent_executions" USING btree ("project_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "triggers_project_received_at_idx" ON "triggers" USING btree ("project_id","received_at" DESC NULLS LAST);--> statement-breakpoint
DROP TABLE "discord_guild_bindings";--> statement-breakpoint
DROP TABLE "github_installation_bindings";--> statement-breakpoint
DROP TABLE "slack_workspace_bindings";--> statement-breakpoint
ALTER TABLE "agent_executions" DROP COLUMN "hub_config_version_id";--> statement-breakpoint
ALTER TABLE "machines" DROP COLUMN "hub_config_version_id";--> statement-breakpoint
DROP TABLE "hub_configs";--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_project_or_dropped_check" CHECK ("triggers"."project_id" is not null or "triggers"."dropped_reason" is not null);
