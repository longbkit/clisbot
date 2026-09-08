# Daemon permissions

For setup steps and user-facing access levels, see the [Paseo + Hub user guide](guides/user-guide/README.md) and [Daemon Administrator guide](guides/user-guide/access/daemon-administrator.md).

The daemon authorizes principals with semantic permissions. RPC names and protocol namespaces are not authority.

## Model

```text
principal -> grants
    |
    +-- authenticated by a device or service credential
    `-- opens a session with equal or narrower authority
```

A principal is the durable identity the daemon authorizes. A credential proves that a device or service represents it. Keep them separate so you can rotate credentials, attach more than one device, and revoke a Hub user without inventing daemon user accounts.

A pairing invitation is neither. It is an expiring, single-use exchange that creates a principal and credential with the permissions selected by its issuer.

## Permissions

| Permission          | Authority                                                                  |
| ------------------- | -------------------------------------------------------------------------- |
| `daemon.read`       | Daemon status, diagnostics, configuration, and provider information        |
| `daemon.manage`     | Restart, update, configuration changes, providers, skills, and plugins     |
| `tunnel.manage`     | Relay, Hub, service tunnel, and public endpoint relationships              |
| `access.manage`     | Pairing invitations, principals, credentials, grants, and revocation       |
| `workspace.read`    | Projects, workspaces, agents, timelines, files, diffs, and terminal output |
| `workspace.write`   | Prompts, agent control, files, terminals, git operations, and scripts      |
| `workspace.manage`  | Create, rename, archive, and remove projects and workspaces                |
| `automation.manage` | Schedules, heartbeats, and loops                                           |
| `hub.execute`       | The Hub-owned execution lifecycle                                          |

Agents and terminals use workspace authority. Both can execute code and mutate the workspace, so separate write permissions would claim an isolation boundary the daemon cannot enforce.

Owner, operator, and viewer are UI presets expanded into explicit permissions. Do not persist them as roles. Adding a permission must not silently widen an existing principal.

Permissions are additive allows. Missing authority denies the operation. Do not add deny precedence.

## Resources

The base semantic permissions are daemon-wide. Clisbot Managed Access additionally enforces
Project grants on requests and outbound observations; see the
[Managed Access contract](audits/2026-08-31-unified-client-managed-access-lite.md). Its explicit
`workspace.create` Project privilege admits only creating a Workspace in an authorized Project,
without granting daemon-wide `workspace.manage`. Project creation still requires
`workspace.manage`. Existing stored grants do not gain new privileges when a UI preset changes.

Future base grants may select workspaces or agents, but operation classification remains inside the authorization module:

```ts
type Grant = {
  permission: Permission;
  resource: { kind: "daemon" } | { kind: "workspace"; ids: string[] };
};
```

A delegating principal can grant only authority it already possesses. A session may attenuate its principal's grants but cannot widen them.

Workspace-scoped grants require every resource-bearing operation and outbound observation to enforce the same workspace boundary. Ordinary trusted sessions can preview any daemon-readable regular file; Managed Access applies its Project resource checks before file operations. These application checks are not an operating-system sandbox for code executed by an agent or terminal.

## Hub

The Hub authenticates as a service principal. Its locally selected grants decide whether it may execute agents, manage the daemon, manage tunnels, or manage access.

Hub user and role identifiers remain opaque external subjects. The Hub may create and revoke linked daemon principals when granted `access.manage`; the daemon does not interpret accounts, organizations, or roles.

Hub enrollment and permission updates exchange these semantic permissions directly. Legacy persisted Hub relationships that contain `hub.execution.*` migrate once to `hub.execute` when the daemon loads them; new relationships never persist or emit transport scopes as authority.

## Channel command access (Hub)

Channel commands use **org Access privileges**, separate from the daemon service
principal's permissions. The Hub resolves the sender's channel identity through
`channelIdentities` to a Member, then checks the command's privilege against its
Channel Connection and authorized daemon/Project. The route's `channel.use` /
`mayTrigger` admission remains the baseline. The old channel role projection and
session initiator do not grant command authority.

`/help` and `/me` are public command entry points. `agent.interact` gates session
status, cowork links, turn controls and configuration; `agent.create` gates
new/resume/fork/side/quick. Dynamic-command changes need `approval.config`.
Approvals retain the open prompt's two authority checks; an unattended mode also
needs the matching `approval.*` privilege. Configuration menus and mutations
must fit the sender's `AgentConfigurationGrant` and conversation visibility.
A final configuration with `featureValues.fast_mode: true` additionally requires
`agent.fast.use`. Profile menus/application, live edits, session creation and
resume enforce this separately. Validation includes features preserved from a
running session when a staged provider selection returns to that provider.
Omitting a feature from a new profile therefore does not bypass its authority
check when the daemon preserves that live feature.

An unlinked sender uses the first-class **Guest group**, stored as
`subjectKind: guest`, `subjectId: guest`. Guest receives no grants by default.
Operators assign its privileges and configuration grants through Access, like
Member or Team assignments. A linked Member uses their own and their Teams'
assignments and does not inherit Guest grants. Linking therefore changes the
subject used for subsequent decisions; it does not merge Guest authority.

`/resume` checks access to the target Agent before changing the conversation
binding, and rejects an Agent already bound to another conversation. Command
output containing identity, configuration or session links is sent privately to
the requester in public conversations. Ordinary text commands use DMs, including
Slack and Discord; a DM failure never publishes the private output publicly.
See the [slash-command reference](features/slash-commands/README.md) for the full
privilege mapping and route-kind restrictions.
