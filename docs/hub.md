# Clisbot Hub relationship

User/channel metadata and session persistence: [agent session storage](features/agent-session-storage/README.md) — durable storage is implemented; the wider AC/W set is not yet fully accepted. Under consideration: [workspace naming and reuse](features/workspace-organization/README.md).

Clisbot Hub is an explicit opt-in connection from one Clisbot daemon to one Hub. Running a daemon does
not register it with a Hub. The relationship begins only when a user runs
`clisbot hub connect [url]` from the daemon machine and approves that Host in the browser. Clisbot assistant onboarding can also explicitly enroll the local daemon through the authenticated local operator API when channel credentials are supplied.

## Hosts in Settings

**Settings → Host → Hosts** is the first destination in the Host group and remains
available before Hub sign-in and when Hub support is disabled. It lists Hosts saved on
the device and, after sign-in, organization Hosts the current account may access. The
existing inventory owns visibility; this page does not grant access or retain a previous
account's organization Hosts after sign-out or account changes. Organization management
actions keep their existing permissions.

If the Hub account or Host inventory fails to load, the page shows an error with a retry
action and keeps saved Hosts available. An unresolved inventory does not show empty-list
guidance.

The main page title is **Hosts**. The navigation row and **All hosts** picker option
show a separate compact **active/total** status badge. The smaller Hosts section heading
spells this out as **1 active / 2 total**. Each badge has a status dot beside the active
count. Active means the app's connection is online, independently of
the Host's Hub link. Each listed Host counts once, including organization Hosts still
waiting for connection details; a saved connection to the same Host is not counted again.

Host rows in the picker and the Hosts list expose the Host ID to distinguish equal names.
Picker accessibility labels include the name, connection status, and Host ID.
An organization Host still waiting for connection details exposes its Hub ID until the Host
ID is available. Picker rows also spell out their connection status: green means online,
the warning dot means connecting (not active), and the danger dot means offline or error.

The sidebar footer and Settings Host selectors always show **Search hosts** when opened,
even with one Host. The footer always offers **All hosts**, whose separate Settings button
opens the Hosts list and closes the picker without changing the sidebar filter. The
existing `/settings/hub/hosts` URL is retained for links; it now opens the list directly
without a sign-in gate.

## Host onboarding

With `CLISBOT_ONBOARDING_ENABLED` enabled (the default), onboarding uses **one command: `clisbot hub connect <Hub URL>`**. It reads the daemon's public identity, starts a browser approval request, and shows the Host, organization and Hub-on-Host permissions before consent. Owner/Admin approval issues a single-use enrollment token bound to the server ID, daemon public key and exact permission set. The request and token expire 10 minutes after the request starts. Approval and token disclosure are persisted transactionally; issuing a Host token never inserts an organization CLI credential. The daemon exchanges the token and keeps its own relationship credential.

The CLI returns the enrollment response, which may still say `connecting`; the daemon finishes the connection in the background and the browser follows its progress. Enrollment activates Managed Access and closes the ticketless CLI session, so onboarding does not poll through that session or obtain a broader credential. Non-TTY and JSON modes use the same browser approval flow; instructions go to stderr. Both the printed link and automatically opened URL include the approval code, so the user does not need to copy it separately. An already enrolled Host on the same Hub is reused without changing permissions. A different Hub requires an explicit disconnect. Lost or expired approval results require a new request; follow connection progress in Settings → Host → Hosts. `hub status` and rerunning `connect` on an enrolled Host require an already authorized daemon connection (local IPC or a managed access ticket). No stored CLI credential is consulted. An explicit `--api-key` or `CLISBOT_HUB_API_KEY` selects unattended enrollment instead; use an API key restricted to `daemons:enroll`.

The existing Hub relationship status RPC adds optional `enrollmentIdentity` data (public only), gated once by `server_info.features.hubEnrollmentIdentity`. Older daemons remain readable; browser enrollment requires the field and fails with an update instruction rather than creating a broad CLI login. Browser decisions include their purpose so an older approval page cannot approve a Host request as a CLI login. The rollout toggle belongs to CLI and Hub: disabling `CLISBOT_ONBOARDING_ENABLED` restores the legacy credential-based CLI connect/login flow and rejects new browser Host-enrollment requests on Hub. Existing authorized requests keep their original scope and expiry.

## Advanced CLI login

`clisbot hub login [url]` is for deliberate CLI API administration, **not Host onboarding**. It stores a durable bearer credential keyed by normalized Hub origin under `CLISBOT_HOME`. The browser approval grants all five Public API scopes: `projects:read`, `configuration:validate`, `configuration:install`, `runs:dispatch`, `daemons:enroll`. The credential can read Projects/configuration, validate and install configuration, dispatch runs and enroll Hosts across its organization. It also supports the CLI access-ticket endpoint, which checks current membership and Host access. It is not a general browser session for every Management API endpoint.

The credential has **no automatic expiry**. Restrict use of `login` to operators who understand this scope and protect the local credential file. Prefer a scoped API key for automation. `hub logout` deletes the local copy; it does not server-revoke the credential. Revoke unwanted CLI credentials in Hub → Configuration → API keys, including credentials created by older onboarding versions. Updating or reconnecting a Host does not revoke them automatically.

`login` does not enroll a daemon in the default flow. `clisbot hub init` creates a seeded daemon Project/Workspace and configures supplied channels through resource APIs; it does not create a Hub Project or scaffold a deployment bundle. See [API-first onboarding](audits/2026-09-06-api-first-onboarding.md) and the [quickstart](../public-docs/hub/quickstart.md). Inherited scaffold/deploy commands are available only with `CLISBOT_ONBOARDING_ENABLED=0`. `hub export [directory]` uses explicit API authority or a stored CLI login to write current triggers as YAML. Origin resolution uses explicit command input, `CLISBOT_HUB_URL`, active login origin, then `https://hub.paseo.sh`.

## Connection and authority

The daemon enrolls over HTTP(S), then opens and maintains a direct outbound WebSocket to the Hub.
The Hub never discovers or acquires the daemon through Clisbot's relay. The relay remains an optional
encrypted path for normal Clisbot clients and has no role in Hub enrollment, authentication, dispatch,
or reconnects.

The daemon persists a relationship ID and private connection credential before enrollment. The
relationship is independent of its current transport, so a future transport can replace the direct
WebSocket without pairing again. The current foundation supports one Hub relationship per daemon.

Normal authenticated daemon sessions may manage the daemon's Hub relationship and permissions.
The relationship protocol grants no implicit daemon permissions. The browser-approved `hub connect`
flow explicitly requests the five permissions listed above; the user sees them before approval.
An enrollment with an empty permission set gives Hub machine identity and presence only. The `hub.execute` permission lets workflows triggered from
GitHub, Slack, Discord, Linear, and other integrations create workspaces and run agents. Grant it
during `hub connect` approval or later with `clisbot hub permissions grant hub.execute`. Relationships
created before this split migrate their legacy execution scope to `hub.execute`. Hub sessions cannot
manage their own relationship or permissions.

## Session grants and agent operations

Hub uses the same authenticated, resumable Session protocol as other clients. Its persisted
`hub.execute` permission authorizes ordinary agent creation, workspace titling, messaging,
cancellation, archival, agent/workspace observation, timeline subscriptions, and workspace recovery. This authority is
daemon-wide; it is not limited to agents created by that Hub. Daemon configuration, terminals,
browser control, and permission management still require their own permissions. See
[permissions.md](permissions.md).

Creating an agent may create a directory workspace. The same `hub.execute` session can title that
workspace through `workspace.title.set.request` without `workspace.manage`.

Clients using this contract check `server_info.features.hubAgentRpc` and
`server_info.features.agentRequestReceipts` once. An older host must be upgraded; do not silently
fall back to creating a fresh agent when continuation was requested.

Hub owns conversation keys, trigger policy, execution records, and the mapping to workspace/agent
IDs. None of these routing concepts are part of the generic daemon RPCs. Creation accepts ordinary
provider configuration, exact MCP tool policy, environment, and workspace/worktree selection.
Private session configuration is persisted for recovery and is not exposed in agent snapshots.
Provider controls remain provider-native; see [providers.md](providers.md).

`create_agent_request.idempotencyKey` identifies one creation operation. With a key, omit
`initialPrompt`, persist the returned agent/workspace identity, then deliver the prompt using
`send_agent_message_request` with a stable `messageId`. An agent created without a title is named
from that first message, by the same rule `initialPrompt` uses. Request IDs correlate individual attempts;
creation keys and message IDs identify the operation across attempts. A creation key is daemon-wide;
a message ID is scoped to its agent. Reusing either with different arguments is a conflict.
`workspace.create.request.idempotencyKey` provides the same creation guarantee for directory and
worktree workspaces; check `server_info.features.workspaceRequestReceipts` before using it.
Workspace creation keys and agent creation keys have separate namespaces. The app keeps these keys
for the lifetime of a draft and reuses the first message ID after failures.

The daemon journals the assigned agent ID before creation. Concurrent retries share one operation,
and a retry after a lost acknowledgement or restart returns the durable agent without creating a
workspace or starting a turn. Deleting that agent does not make its old creation key reusable.
Confirmed message delivery is also journaled, so retrying its message ID does not submit it again.
An unfinished delivery after restart reports `agent_request_outcome_unknown`: a provider can have
accepted a prompt before the daemon recorded success, so automatic resubmission could duplicate
work. Inspect the agent before choosing a new message ID. A failure that proves the provider never
received the prompt (`PromptNotDeliveredError`, such as OpenCode's event stream never becoming
ready) drops the receipt and withdraws the message's submission, so retrying the same message ID
delivers it once. Receipts contain identity and request
hashes, never prompts, environment values, or credentials.

Before messaging an archived workspace, call `workspace.recovery.inspect.request`, then
`workspace.recovery.restore.request` and await success. The native message handler unarchives the
agent and loads its persisted provider session. `activeTurnBehavior: "steer"` uses the provider's
native steering behavior, including Clisbot's existing behavior when that provider cannot steer.
Execution completion and arrival-specific output authority remain Hub responsibilities.

The older `hub.execution.*` RPCs remain accepted for existing clients. Their execution ownership
and create deduplication behavior are unchanged; new continuation work uses the ordinary RPCs.

## Disconnect and revocation

Normal socket loss reconnects the active relationship with bounded exponential backoff and jitter.
Daemon restart loads the same relationship and credential and reconnects without another enrollment
ceremony.

Hub authentication rejection or close code `4403` permanently revokes the local relationship. The
daemon deletes its credential, stops reconnecting, and retains only the relationship ID, Hub origin,
scopes, and a sanitized reason for status reporting.

`clisbot hub disconnect` disables socket reconnect and execution authority before making one bounded
remote revocation request. The daemon then removes the local relationship whether the request
succeeds or fails. A failed request returns a warning that server-side revocation may remain pending.
`--force` skips the remote request. Legacy persisted `disconnecting` records are removed on startup;
the daemon does not retry revocation in the background.

`clisbot hub logout` removes only the active human CLI credential and preserves credentials for other origins. Interactive logout inspects and optionally disconnects a same-origin daemon before deleting the login; a failed requested disconnect preserves the login. JSON and noninteractive logout never prompt or disconnect implicitly.

## Cross-repository compatibility

The consumer implementation lives in Clisbot Cloud. Cloud owns its copy of the Hub wire schemas and
has no Clisbot runtime or build dependency. Cross-repository end-to-end verification separately builds
a Clisbot source checkout and exercises the real daemon, CLI, direct WebSocket, Cloud service, and
Postgres. That compatibility fixture is not a package dependency or fallback implementation.
Its `hub-e2e` ACP provider accepts only exact tool names on the injected `hub` MCP server. Other
custom ACP providers remain unsupported for unattended preapproval.
