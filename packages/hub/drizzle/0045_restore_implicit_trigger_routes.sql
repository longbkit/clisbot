with broken_trigger as (
  select
    t.id as trigger_id,
    t.organization_id,
    t.active_revision_id,
    t.runtime_project_id,
    r.created_at as migrated_at,
    r.normalized_configuration #>> '{triggers,0,on}' as configured_event_name
  from organization_triggers t
  join organization_trigger_revisions r on r.id = t.active_revision_id
  where t.enabled
    and r.source_kind = 'project_migration'
    and split_part(r.normalized_configuration #>> '{triggers,0,on}', '.', 1)
      in ('github', 'slack', 'discord', 'linear')
    and r.normalized_configuration #>> '{triggers,0,filters,connectionId}' is null
    and r.normalized_configuration #>> '{triggers,0,filters,repo}' is null
    and r.normalized_configuration #>> '{triggers,0,filters,workspace}' is null
    and r.normalized_configuration #>> '{triggers,0,filters,guild}' is null
    and r.normalized_configuration #>> '{triggers,0,filters,project}' is null
    and not exists (
      select 1 from organization_trigger_routes route where route.trigger_id = t.id
    )
), provider_connection as (
  select organization_id, id as connection_id, 'github' as provider, connected_at
  from github_connections where status = 'active'
  union all
  select organization_id, id, 'slack', connected_at from slack_connections
  union all
  select organization_id, id, 'discord', connected_at from discord_connections
  union all
  select organization_id, id, 'linear', connected_at from linear_connections
)
insert into organization_trigger_routes (
  organization_id, trigger_id, trigger_revision_id, provider,
  connection_id, resource_id, configured_event_name
)
select
  broken.organization_id,
  broken.trigger_id,
  broken.active_revision_id,
  connection.provider,
  connection.connection_id,
  null,
  broken.configured_event_name
from broken_trigger broken
join provider_connection connection
  on connection.organization_id = broken.organization_id
  and connection.provider = split_part(broken.configured_event_name, '.', 1)
  and connection.connected_at <= broken.migrated_at
on conflict do nothing;

--> statement-breakpoint

with broken_adapter as (
  select
    t.id as trigger_id,
    t.organization_id,
    t.runtime_project_id,
    project.active_configuration_revision_id as runtime_revision_id,
    r.created_at as migrated_at,
    r.normalized_configuration #>> '{triggers,0,on}' as configured_event_name,
    r.normalized_configuration #>> '{triggers,0,name}' as configured_trigger_name
  from organization_triggers t
  join organization_trigger_revisions r on r.id = t.active_revision_id
  join projects project on project.id = t.runtime_project_id
  where t.enabled
    and r.source_kind = 'project_migration'
    and split_part(r.normalized_configuration #>> '{triggers,0,on}', '.', 1)
      in ('github', 'slack', 'discord', 'linear')
    and r.normalized_configuration #>> '{triggers,0,filters,connectionId}' is null
    and r.normalized_configuration #>> '{triggers,0,filters,repo}' is null
    and r.normalized_configuration #>> '{triggers,0,filters,workspace}' is null
    and r.normalized_configuration #>> '{triggers,0,filters,guild}' is null
    and r.normalized_configuration #>> '{triggers,0,filters,project}' is null
    and not exists (
      select 1 from project_trigger_routes route
      where route.project_id = t.runtime_project_id
    )
), provider_connection as (
  select organization_id, id as connection_id, 'github' as provider, connected_at
  from github_connections where status = 'active'
  union all
  select organization_id, id, 'slack', connected_at from slack_connections
  union all
  select organization_id, id, 'discord', connected_at from discord_connections
  union all
  select organization_id, id, 'linear', connected_at from linear_connections
)
insert into project_trigger_routes (
  organization_id, project_id, configuration_revision_id, provider,
  connection_id, resource_id, trigger_name
)
select
  broken.organization_id,
  broken.runtime_project_id,
  broken.runtime_revision_id,
  connection.provider,
  connection.connection_id,
  null,
  broken.configured_trigger_name
from broken_adapter broken
join provider_connection connection
  on connection.organization_id = broken.organization_id
  and connection.provider = split_part(broken.configured_event_name, '.', 1)
  and connection.connected_at <= broken.migrated_at
on conflict do nothing;
