# Changelog

## 0.8.0 - 2026-08-25

### Added

- Pull-request-created and pull-request-label-added workflows now receive GitHub webhook deliveries.
- GitHub issue and pull-request triggers now react on the item with `eyes` when accepted, then `+1` on success or `-1` on failure.

### Fixed

- Workflows triggered by Discord, Slack, GitHub, or manual input can use capabilities owned by another provider without losing valid authority.
- Workflow preparation failures retain their actual safe reason instead of being reported as `daemon_unreachable`.
- Deleting a Discord trigger message no longer leaves Hub retrying an impossible terminal reaction.

## 0.7.0 - 2026-08-23

### Added

- A post-app onboarding step that gives operators the exact `paseo hub login` command, watches for their daemon to connect, and lands them in the Default project.
- An authenticated setup-resources API for guided clients to discover usable GitHub repositories, Slack workspaces, and Discord servers.

### Changed

- Textual triggers now preserve the complete message as `${{ paseo.prompt }}` while exposing parsed typed inputs separately.
- Startup logs print the complete browser URL for the running Hub.

### Fixed

- Legacy project Activity URLs redirect to the active organization's canonical Activity page.
- Trigger prompts no longer lose mentions, typed-input headers, surrounding whitespace, or text before a suffix mention.

## 0.6.0 - 2026-08-21

### Added

- Explicit GitHub triggers for created issues, pull requests, issue comments, pull request comments, and labels added to issues or pull requests.
- Case-insensitive GitHub label filters for the label changed by an event and the labels currently present on an issue or pull request.

### Changed

- GitHub App onboarding now includes pull request events. Existing GitHub trigger names remain compatible with their previous behavior.

## 0.5.1 - 2026-08-20

### Fixed

- Production startup ignores `.env` files, so zero-configuration launches use embedded storage even when run from a directory containing unrelated database settings.

## 0.5.0 - 2026-08-20

### Added

- A zero-configuration local start with an embedded PGlite database, generated durable authentication secret, and first-run operator account setup.
- Browser-guided GitHub, Slack, and Discord app onboarding.
- Slack Socket Mode for local bots that do not have a public URL.
- A published `@getpaseo/hub` package that runs with `npx @getpaseo/hub`.

### Changed

- Embedded Hub data now lives under `$XDG_DATA_HOME/paseo-hub`, falling back to `~/.local/share/paseo-hub`.
- Configuration deployment can create or restore its implicit target project.

### Fixed

- Slack username allowlists resolve consistently during provider setup.

## 0.4.0 - 2026-08-12

### Added

- Execution-scoped worktree branch templates with `${{ paseo.execution.id }}` for unique branches that remain stable through retries and recovery.
- Structured server logs for connection callbacks, provider event intake and routing, and workflow failures without recording event payloads or credentials.
- A ready-to-adapt single-repository team bot example.

### Changed

- Provider reactions now follow the workflow run instead of each step, preventing duplicate reactions in multi-step workflows.

### Fixed

- Discord replies create or reuse one conversation thread, and explicitly requested context includes the directly referenced message.
- Terminal workflow notifications are not lost when recovery and completion overlap.

## 0.3.0 - 2026-08-10

### Added

- Multi-file configuration bundles with named environments, named agents, reusable prompt partials, and independently routed workflows.
- Explicit `${{ paseo.context }}` access for provider context without rewriting `${{ paseo.prompt }}`.
- Step-scoped GitHub credentials with repository, permission, and duration controls.
- Safe routing reasons for known events that no workflow accepted.

### Fixed

- Self-hosted sign-in works over explicitly configured remote HTTP origins.
- GitHub App identity lookup uses scoped authentication and avoids public API rate limits.
- Daemon enrollment names are derived consistently from hostnames.

## 0.2.0 - 2026-08-09

### Added

- Browser-based project configuration editing, including prompt partials and GitHub-backed configuration.
- Durable Hub login support for the Paseo CLI.
- Provider-specific passthrough options with provider-owned validation.
- Scoped preapproval for the exact Hub MCP tools authorized by each workflow step.

### Changed

- Project selection and configuration flows are clearer in the dashboard.

### Fixed

- Prompt partials remain available when configuration authority changes.
- Long configuration files and GitHub source controls remain usable in the configuration editor.

## 0.1.0 - 2026-08-07

### Added

- Self-hosted automation for Paseo daemons with durable PostgreSQL-backed workflows.
- Discord, Slack, GitHub, and manual triggers for multi-step agent workflows.
- Project configuration through the dashboard, GitHub synchronization, prompt partials, and `paseo hub deploy`.
- Organization authentication, daemon enrollment, API keys, and scoped access controls.
- Stripe billing, organization usage visibility, and operator-managed plan limits.
- A versioned public API with an OpenAPI 3.1 specification and interactive reference.
