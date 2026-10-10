# What can a Daemon Administrator do?

[User guide](../README.md) · [Permission levels](permissions.md) · [Q&A](../help/faq.md)

**Daemon Administrator is the right to operate a whole daemon.** It includes Connect, use of every current and future Project on that daemon, and administration rights. The Project and Agent configuration filters that apply to regular Members do not limit this Administrator session.

## Scope

| Area                       | Administrator can                                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status and diagnostics     | View daemon status, configuration, providers/models, usage, and diagnostics                                                                                                                                                       |
| Daemon operations          | Restart, shut down, update, reload or change configuration, manage providers, skills, and plugins, call plugin functions                                                                                                          |
| Projects and Workspaces    | Add a folder, clone, or create a Project; create local Workspaces and worktrees; rename, archive, delete, and manage resource lifecycle                                                                                           |
| Agents                     | View history, create/import/control/archive/delete sessions, send prompts, change model/thinking/mode, and answer approval requests                                                                                               |
| Files and Git              | Read/write/create/delete/rename/upload/download files; view diffs, commit, branch, stash, discard, pull/push/merge, and the PR actions the daemon supports                                                                        |
| Terminals and running code | Create terminals, type commands, view output, close terminals, run scripts/services, and open an editor                                                                                                                           |
| Connectivity               | Manage the Hub relationship, relay/tunnel, and endpoints, as far as the daemon supports them                                                                                                                                      |
| Daemon access              | Manage pairing and daemon access; change the permissions of the Hub service relationship. The permission contract covers invitations, principals, credentials, grants, and revocation; not every item has its own form in the app |
| Local automation           | Manage schedules and heartbeats/loops on the daemon: create, edit, delete, stop, run, and view logs through the supported API                                                                                                     |

Technically, this session holds `daemon.read`, `daemon.manage`, `tunnel.manage`, `access.manage`, `workspace.read`, `workspace.write`, `workspace.manage`, `automation.manage`. See the [permission contract](../../../permissions.md) when you need to check against the API.

## Can they change Managed Access?

Yes, at the backend: `daemon.manage` allows changing daemon configuration, including Managed Access. The app shows this switch only to the Organization Owner, but an Administrator still has the backend authority and can run code on the daemon machine.

So do not grant Administrator to someone you want to keep inside one Project. Use **Connect + Developer** when they need to create worktrees.

If they need to work on **every Project** but stay limited to certain providers/models, grant **Developer on the Host** instead of Administrator; if they also need to create Projects, grant **Full access on the Host**. These levels cannot operate the daemon, and Agent configuration limits still apply; see [grant every Project on a Host](members-and-teams.md#grant-every-project-on-a-host).

## What does not come with it

- **No Hub Organization Admin/Owner role:** they cannot invite Members, edit the organization's Teams/Access, configure Channels/Hub Automations or API keys, or rename the shared Host on the Hub.
- **No rights on other daemons:** you grant each daemon separately. It does not make them an instance operator of the Hub server.
- **Not OS root:** commands run as the daemon's OS account, with that account's permissions. They can still run code and read/write outside Project folders where the OS allows it.
- **No Hub service identity:** `hub.execute` serves the Hub-owned execution lifecycle and is granted to the separate Hub service relationship. The interactive Administrator session does not carry it; because an Administrator manages access, they can change the Hub relationship's grants.
- **Managing local schedules is not managing Hub Automations:** Hub definitions, audience, and Run permission are managed separately.

## Grant and verify

In **Access**, choose the Team/Member → the Host to administer → level **Administrator** → confirm. Check that it is the right Host before saving. To revoke, remove every Administrator assignment, direct and through Teams; separate Connect/Project grants can still allow limited work.
