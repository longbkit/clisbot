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

## Temporary runtime adapter

Projects are gone from the product and configuration model. For this release, Hub still creates a
hidden project row per trigger as an internal adapter to the existing execution engine. These rows
are not listed or editable as projects. Keeping one adapter row per trigger is important: updating
one trigger cannot replace another trigger's active configuration. The former user project is
archived and its event routes are removed after every trigger has been created successfully.

The adapter is implementation debt, not a compatibility promise. Stored trigger YAML and trigger
revisions are the canonical authoring model and can survive removing the adapter later.

The simple editor writes `from_users: ["*"]` when “Allowed users” is left at its default. The
wildcard is an explicit allow-everyone policy for Slack, Discord, and GitHub; an absent or empty
allowlist still fails closed.

New single-run triggers require an absolute daemon working directory and an explicit agent mode.
Existing migrated YAML keeps its authored provider defaults until it is edited. Legacy output
grants and limits remain enforceable, but newly-authored conversational triggers automatically
receive an unlimited provider-native `hub.reply`; `hub.finish_execution` remains available to every
execution. GitHub replies are posted to the issue or pull request that originated the event.

## CLI deployment tradeoffs

The new CLI reads sorted direct children of `.paseo/triggers/` and upserts each by YAML name. It
does not delete a server trigger merely because its file is absent. A directory deployment is not
atomic across files: if file three is invalid, files one and two may already be active. Fix the
invalid file and rerun. Each individual trigger install is validated and committed atomically.

The old project bundle API remains temporarily available so an installed older CLI does not fail
at the authentication or transport boundary. It is not used by the new CLI or documented for new
users.

## Workflows kept in the legacy lane

Hub does not guess when flattening could change execution. Multi-step workflows, workflow values,
conditional runs, dynamic targets, and duplicate output grants remain runnable as self-contained
`legacy_multistep` revisions. Their shared files are resolved into the stored snapshot, so deleting
the old project bundle does not strand them.

An invalid active revision or a revision missing its authored bundle stops startup with the project
and revision identified. Hub does not mark that project migrated or partially activate its
triggers; fix or restore the revision and restart.
