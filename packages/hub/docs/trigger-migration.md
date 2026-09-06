# Project-to-trigger migration

Hub migrates each active project workflow to an organization-owned trigger during startup. The
migration finishes before provider events are accepted and is safe to retry after a failed start.

## What is preserved

- Event type, filters, connection routing, and invocation inputs
- Daemon, working directory, and worktree behavior
- Agent provider configuration and finite agent selection
- The rendered prompt text, including resolved prompt partial content
- Environment variables, GitHub authority, structured output, output grants, and timeouts
- Multi-step execution behavior through an internal `legacy_multistep` revision when it cannot be
  represented safely as one run

## Intentional losses

These affect authoring or presentation, not what the active trigger is allowed to do:

- YAML comments, whitespace, key ordering, anchors, and quoting style are regenerated.
- Prompt partial boundaries and file names disappear after their resolved content is inlined.
- Shared environment and agent names disappear after their values are inlined.
- A converted one-run workflow uses the internal step ID `run`; the former step ID remains only in
  migration evidence.
- New trigger revision numbering starts at 1. The former project revision and version remain in
  migration evidence.
- Projects no longer group triggers. If two projects contain the same trigger name, the first keeps
  it and later collisions receive a deterministic `<project>-<trigger>` name (then a numeric suffix
  if needed).
- GitHub/manual bundle authority is recorded as migration provenance. Future edits belong to the
  trigger rather than to the former project bundle.
- Historical runs keep their original internal project ID. Organization Activity correlates them
  to the migrated trigger by its immutable former workflow name; those rows are not rewritten.

## Current Fusion storage

Projects are gone from the product and configuration model. Fusion saves new
organization-owned trigger revisions without creating hidden Project adapter rows.
Historical Project IDs remain on old runs for compatibility; old data is not deleted
by assistant onboarding. Fresh organization provisioning also skips the obsolete
Default Hub Project when `CLISBOT_ONBOARDING_ENABLED` is enabled (the default).

The simple editor writes `from_users: ["*"]` when “Allowed users” is left at its default. The
wildcard is an explicit allow-everyone policy for Slack, Discord, and GitHub; an absent or empty
allowlist still fails closed.

New single-run triggers require an absolute daemon working directory. Agent mode is optional:
omit it to use the Provider default, including Providers such as Pi that expose no selectable modes.
Explicit modes are passed through for Daemon validation. Legacy output
grants and limits remain enforceable, but newly-authored conversational triggers automatically
receive an unlimited provider-native `hub.reply`; `hub.finish_execution` remains available to every
execution. GitHub replies are posted to the issue or pull request that originated the event.

## CLI configuration flow

Fusion's default `hub init` provisions a seeded daemon Workspace and updates supplied
channels through APIs. It does not write or deploy a Hub Project bundle. Update
resources through their APIs or the Hub UI; exports are optional portability files.
`CLISBOT_ONBOARDING_ENABLED=0` exposes the inherited scaffold/project/deploy commands
only for rollout fallback. A future directory-import command is not implied by this
migration; the upstream description of `.paseo/triggers/` deployment was not an
implemented contract of the inherited CLI at the audited revision.

The old project bundle API remains temporarily available so an installed older CLI does not fail
at the authentication or transport boundary. It is not used by the default onboarding flow.

## Imported workflow snapshots

Hub does not guess when flattening could change execution. Multi-step workflows, workflow values,
conditional runs, dynamic targets, and duplicate output grants remain runnable as self-contained
snapshots carrying the historical internal `legacy_multistep` tag. This tag describes the import
format, not the lifecycle or capability of multi-step Workflows. Their shared files are resolved into the stored snapshot, so deleting
the old project bundle does not strand them.

An invalid active revision or a revision missing its authored bundle stops startup with the project
and revision identified. Hub does not mark that project migrated or partially activate its
triggers; fix or restore the revision and restart.

The Automation API now accepts self-contained workflow documents with `environments`, optional
named `agents`, the existing event map, and the compiler's `steps`/`values` fields. New workflow
saves use `format: workflow`. Migration 0064 extends the database format constraint without
rewriting historical records. Snapshot projection resolves compiled expressions back to authored
expressions and embeds resolved prompt partial content; an explicit save revalidates all targets
and authority. The workflow engine is unchanged.
