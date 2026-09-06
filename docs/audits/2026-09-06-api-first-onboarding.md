# API-first assistant onboarding

Date: 2026-09-06
Status: implemented and verified

## Decision

The user authorized replacing the inherited Hub Project / scaffold / deploy
onboarding with direct resource APIs. Hub has no product-level Project.
Project means the daemon's selected root and its Workspaces.

The personal assistant root is `<resolved Clisbot home>/workspaces/default`.
Team assistants default to `workspaces/team` to avoid sharing personal context;
existing manifests keep their selected paths.
Home resolution retains `--home`, `CLISBOT_HOME`, `PASEO_HOME`, `~/.clisbot`.
An explicit workspace path wins. Never derive the default execution target from
process.cwd(), and never seed instructions in the OS home root.

The bundled personal/team instruction sets are seeded before provider startup.
Existing files, including symlinks, are preserved and reported. There is no
implicit template upgrade or overwrite of user context. Explicit `--overwrite-template`
backs up existing regular template files before replacing them.

CLI composes daemon workspace/agent operations and Hub resource APIs. The Hub
owns encrypted Connections, Channel configuration revisions and Member identity
verification. The existing direct Channel–Agent execution model creates and
resumes sessions per conversation, using the seeded workspace; the locally
created initial agent is available in the app and is not falsely advertised as
the agent to which every channel conversation is bound.

Owner access reuses Member authorization. A bot token identifies the bot, not its
human owner. Reuse a linked owner identity; a local operator may explicitly
supply the owner's provider user ID. Otherwise issue the existing one-time
identity-link command for that owner. Never grant owner to the first sender or
use an open-audience route as a shortcut. Report pending identity verification
and unavailable transports as pending, not as ready.

The local operator API uses the existing Channel control-plane authentication
and kill switch. It can issue a short-lived enrollment token for the configured
organization and compose the existing enrollment and Channel revision stores.
No new persistent bot entity is added on the Hub. The CLI manifest remains the
restart reference and stores no credential values.

`CLISBOT_ONBOARDING_ENABLED=0` retains the inherited CLI setup surface while the
new flow rolls out. Channel APIs also retain their existing channel kill switch.
Changes to shared upstream files are limited to registration/composition seams;
Clisbot behavior lives in its bot/onboarding modules. No daemon wire change is
required. Existing user data and unrelated working-tree changes must remain intact.

## Superseded documentation

The default Hub Project, automatic legacy bundle deployment, template `--force`,
and hand-written route steps in the 2026-08-24 onboarding proposal are historical.
The 2026-08-23 workspace-template catalog proposal is not proof of an implemented
daemon-wide template feature. This work provides the assistant onboarding seed;
it does not silently seed arbitrary app/MCP workspace creation.

Export/import are optional backup/portability tools, not prerequisites for
configuration updates. The normal flow calls the resource API directly.

## Current flow

1. Resolve the shared home and explicit workspace, then start the daemon and local Hub.
2. Create/reuse the daemon Workspace and its Project. Seed the bundled instruction files
   into the daemon-returned directory before creating the initial assistant agent.
3. For channel setup, select the existing owner or bootstrap the initial owner from
   explicitly supplied email/password. The authenticated local operator endpoint issues
   a short-lived enrollment token; the daemon stores its own relationship credential.
4. Verify supplied channel credentials and persist the Connection with the existing
   encrypted credential store. Configure named agent/environment resources and member
   routes in an organization-owned Channel revision, retaining unrelated routes. Slack
   channel replies start a thread under the request; Telegram retains its native topic/group context.
5. Reuse the owner's verified channel identity, accept an explicit local-operator assertion,
   or print a one-time linking command. Start the account and report actual transport state.

Bare `hub init` provides the seeded workspace and app agent without requiring a channel.
With channel flags, it uses the same orchestration as `bot start`. A checkpoint before
Channel installation retains daemon IDs after failure. A successful installation stores
only the Connection ID in the manifest, allowing later starts without resupplying tokens.
The human-readable and JSON results both preserve actionable error messages.
Normal restarts retain existing route policy and agent/environment edits made through
the Hub API. Explicit runtime flags update the selected runtime resources; seeding is
not a recurring enforcement of defaults. A verified identity belonging to another
Member is not silently reassigned during onboarding.

## Legacy retained deliberately

- The inherited CLI `init` scaffold, `projects`, and `deploy` implementation remains
  behind `CLISBOT_ONBOARDING_ENABLED=0`; those project/deploy commands are absent from
  default help. Login's default continuation points to direct Hub configuration.
- Older bundle API and historical Project/run records remain for compatibility. This
  change does not delete existing operator data or retrofit a migration over it.
- New organization provisioning and bootstrap adoption skip the obsolete Default Hub
  Project in the enabled flow. Fusion's current trigger store also does not create the
  hidden per-trigger Project adapter described by older upstream migration prose.
- The `.paseo/hub.yml` names in Channel revision internals are serializer paths in the
  existing configuration store, not files users must export, edit, or deploy.

## Verification

Implemented checks cover template preservation, actual worktree paths, retry after
Channel failure, credential-free restart, owner admission and stranger rejection,
organization provisioning with no Hub Project, and enabled/disabled rollout behavior.
The packaged CLI embeds its seed catalog; no checkout-relative asset lookup is needed.

Live verification uses only the fixed `.env` development home (`~/.clisbot-dev`).
The cold run exposed and fixed the 20-second database startup timeout, provider discovery
loading snapshots, mismatched localhost/127.0.0.1 enrollment origin, and accidental
interpretation of bare CLI Slack token variables as legacy environment configuration.
The local Slack operation uses the HTTP adapter's trusted origin; the browser's origin
checks remain enforced on browser operations.

Verified on the real development stack:

- Local `hub init` run from `/tmp`: Project `prj_3db8a37a52df5b17`, Workspace
  `wks_919bbf36376c45f0`, 9 seed files in `~/.clisbot-dev/workspaces/default`.
- Slack token verification, encrypted Connection, route activation and owner linking:
  `ownerReady: true`, transport `started`. Owner mention `1788680259.934369` received
  reply `1788680268.003319`, matching `ONBOARDING_OK_1788680256777`; verified through
  `slack-cli` channel history. The initial run used the inherited root reply default;
  new Slack route seeds now explicitly use threads and that default is unit-tested.
- Telegram DEV bot: Connection persisted and polling started. Missing human Telegram
  identity correctly returns a one-time challenge and `ownerReady: false`. No Telegram
  human-owner round-trip is claimed from this check.
- Offline read-back of the same embedded DB after clean Hub stop: 0 Hub Projects,
  1 Slack Connection, 1 Telegram Connection, 1 owner; verified Slack owner permitted,
  unlinked stranger denied. No credential values occur in either bot manifest.

Targeted CLI and Hub tests, CLI/server and Hub builds, and CLI/Hub typechecks were run.
PostgreSQL container variants were updated to the same no-default-Project expectation;
they were not executed because the local Docker daemon is unavailable. Embedded
storage tests exercise actual provisioning and revision SQL, including flag-off behavior.

Restart verification also passed after stopping Hub and removing all Slack/Telegram
and bootstrap credentials from the child environment: the CLI reused the same
Workspace and initial agent, read the persisted Connection, and reported
`ownerReady: true` with transport `started`.

No production home, release, commit, or deployment is part of this task.

## Follow-up: multiple local homes

The initial live verification used one development home and missed port collisions
with a second home. A later onboarding attempt exposed two false-ready paths:

- A Hub child could fail to bind `6868`, while `/health` from the first home made
  the CLI proceed against that first Hub. Its owner lookup then returned a
  misleading Account setup conflict even with valid bootstrap flags.
- A daemon supervisor could stay alive while its worker repeatedly failed to bind.
  Treating the supervisor PID as ready let the CLI fall back to a configured
  address belonging to another daemon.

On first setup, onboarding now selects an available loopback port when its
default port is occupied. A recorded Hub launch keeps its port; if another
process has taken it, restart fails instead of changing enrollment origin. Explicit daemon `PASEO_LISTEN` and Hub `--port` choices remain explicit
and fail on a collision. The Hub records a per-launch identity and returns it from
health; onboarding checks that identity and the recorded live process before
continuing. New Hub state retains its selected port across `hub stop` and restart.
The daemon must record an actual listener, and its reported server ID must match
this home's `server-id` before any onboarding resource writes.

Regression checks cover two real HTTP listeners/port allocation, mismatched Hub
identity, dead Hub children, supervisor-without-listener rejection, daemon identity
mismatch, port retention, and disabled onboarding behavior. Existing daemon–Hub
relationships are preserved; onboarding does not silently disconnect another Hub.

The reported second-home failure was reproduced from its saved state and logs:
Hub `EADDRINUSE` on 6868 and a daemon supervisor repeatedly failing to bind 6767.
After the fix, that home's Hub started on a separate port; the per-launch health
identity matched and the owner preparation API returned HTTP 200 with the expected
email. Its existing daemon has a managed Hub relationship, so switching enrollment
is a separate user decision; no full Slack onboarding success is claimed for it.

CLI onboarding also preflights persisted managed-access policy before starting or
connecting infrastructure. An existing `external` TCP installation now returns one
actionable error instead of retrying a ticketless connection; authenticated local
IPC recovery remains available. A revoked Hub relationship does not implicitly
turn managed access off. No access-policy or relationship reset is performed.

## Follow-up: actionable CLI results

Human onboarding output now puts pending owner identity linking before infrastructure
rows and reports READY only when owner and transport are ready. The Hub carries the
AccessStore challenge expiry through the optional API response field to CLI JSON and
human output. Codes last 10 minutes, are single use, and renewal invalidates older
codes. The printed restart command includes the selected home/bot/owner and requires
no channel credentials; bot status also exposes a recovery command. Plaintext codes
are never persisted in the bot manifest.

Explicit `--overwrite-template` uses private in-workspace backups and atomic file
replacement, skips symlinks and non-files, and never becomes a persisted overwrite
policy. The existing authenticated password-change API is exposed through
`hub password change`, requiring the current password and revoking other sessions.
The password-change command requires the current password. Optional master-password
recovery was subsequently added as described below; bootstrap flags still do not
override existing passwords.

Validation: targeted CLI tests and the embedded Hub onboarding integration passed,
including expiry, renewal invalidation, single use, overwrite backup/preservation,
and authenticated password-change requests. CLI and Hub builds and Hub typechecks
passed. A live restart against `.clisbot-dev-01` reused the existing bot without
channel tokens, reported READY with the already linked owner, kept the daemon at
its existing address, and preserved all nine template files. No live password or
template content was changed.

## Follow-up: optional master-password recovery

CURRENT: `CLISBOT_MASTER_PASSWORD` enables an instance-wide recovery authority at
Hub startup; unset/blank disables the endpoint and weak values fail startup. CLI
`hub password reset` supplies that authority to `POST /api/auth/paseo/reset-password`.
The existing account/password store stays authoritative: no new account or role is
created. Reset, browser/OAuth session revocation and organization audit records
commit together. The recovery audit makes the live-session check apply to recovered
OAuth accounts even if the master password is subsequently removed. Default
accounts without recovery history keep their existing OAuth behavior.

The server uses constant-time comparison of fixed-length digests, bounded JSON,
five attempts/minute/process, no secret response/logging, and rejects cross-site
browser requests. The CLI requires HTTPS or loopback HTTP and refuses redirects.
The optional secret is injected only at the Hub composition root and excluded from
external agent/terminal environment inheritance. This does not isolate processes
sharing OS permissions or stop an agent reading an accessible `.env` or database.
No automatic master-secret persistence, web recovery UI, or email service is added.

Scope: existing browser sessions and OAuth credentials are revoked; organization
API keys, CLI credentials, channel links and bot data are preserved. The operator
must configure the master secret in the environment of the correct Hub and restart
that Hub when rotating/removing it. Recovery grants authority across the whole Hub.

The signed-token recovery regression also exposed the resource client's default
JWKS lookup at `/jwks`, while Hub mounts auth at `/api/auth/jwks`. The verifier now
passes that existing endpoint explicitly. This fixes the existing mount mismatch;
it adds no endpoint or alternate token authority.

Validation: 39 focused tests passed across CLI password/command handling, external
process environments, and embedded-database recovery. Coverage includes disabled
recovery, invalid credentials, bounded input, throttling, cross-site rejection,
account preservation, transaction rollback on audit failure, old/new password
login, and real signed OAuth JWT rejection after reset followed by successful
fresh OAuth authorization. CLI, server library, and full Hub builds, Hub node/start/e2e
typechecks, and scoped lint passed. No live user password or master-secret
configuration was changed during implementation.
