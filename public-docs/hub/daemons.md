---
title: Daemons in Hub
description: Enroll a machine with Hub, reference it from configuration, and understand what Hub owns once it is connected.
nav: Daemons
order: 63
category: Hub
---

# Daemons in Hub

A daemon is one of your machines running the Clisbot daemon. Enroll it once with your Hub organization, then triggers can reference it.

## Connect

Run this on the machine with the daemon already running:

```sh
clisbot hub connect https://hub.example.com
```

Open the printed URL (the code is filled in automatically) and approve the **Host, organization and Hub permissions** as an organization owner/admin. The CLI then enrolls the Host and returns its current status. If it says `connecting`, the daemon finishes in the background and this page follows its progress. There is no preliminary `login` or second terminal confirmation. Non-TTY/Docker `exec -T` and `--json` follow the same flow; keep the command running while approving in a browser.

The single-use token is bound to this Host's identity and approved permission set, and expires with the request after 10 minutes. The daemon retains its own relationship credential. This flow **does not create a CLI administration credential** or use a previously stored CLI login. Default Hub-on-Host permissions are `hub.execute`, `daemon.read`, `workspace.read`, `workspace.write`, `workspace.manage`; override with `--permission <permission...>`. Human Host/Project access is managed separately.

Follow a slow connection in Hub → Hosts. After enrollment, `hub status` and rerunning `connect` require an authorized daemon connection (local IPC or a managed access ticket). If the approval result was lost before enrollment, start a new request. See [Quickstart](/docs/hub/quickstart) for the rest of setup.

A daemon's identity (its server ID and key) lives in its `CLISBOT_HOME`. Copying that directory to another computer, cloning a VM, or baking it into a container image copies the identity too. Hub refuses to enroll a second daemon with a server ID another Host in the organization already uses, and names that Host. On the copied computer, reset the identity and connect again:

```sh
clisbot daemon stop
clisbot daemon reset-identity
clisbot daemon start
clisbot hub connect https://hub.example.com
```

`reset-identity` removes `server-id`, `daemon-keypair.json`, and `hub-relationship.json` from `CLISBOT_HOME`. It refuses while the daemon runs or while `CLISBOT_SERVER_ID` is set, since that variable would restore the same ID. Hub also accepts connection details from a daemon only for the identity it enrolled with.

Hub derives the daemon's initial slug from its hostname. If that slug is already used in the organization, Hub adds a short daemon ID suffix. You can rename the daemon later in Hub.

Each daemon has two identifiers: an immutable generated ID and a friendly slug. Hub normalizes slugs with lowercase words joined by hyphens, so `Build Studio` becomes `build-studio`. The dashboard shows the slug. Configuration accepts either the slug or the immutable ID.

You can rename the slug later without changing the daemon ID. Configuration referencing the slug must be updated after a rename; references using the immutable ID remain valid.

In Clisbot, open **Settings → Hosts → Rename** with an organization Owner or Admin account.
The dialog changes the shared Hub name and reports name conflicts inline. Daemon Administrator
access alone does not grant organization configuration authority. Hosts following the shared name
update without reconnecting; a local name chosen in Host Appearance stays personal to that app.

With Managed Access enabled, creating a new Project requires Daemon Administrator or Owner
authority. To let a Member create Workspaces or Git worktrees in one existing Project, assign
**Developer** or **Full access** on that Project, with the allowed Agent configuration. These
presets include the explicit `workspace.create` privilege for new grants. Existing assignments
must be reviewed and saved with the preset again to gain it. The Member then opens that Project,
chooses **New workspace**, and selects **New worktree** for Git isolation. This does not permit
creating new Projects or managing other Projects. Update the daemon before granting the new
privilege; older daemons reject unknown Project privileges.

For unattended setup, inject an organization API key restricted to `daemons:enroll` without storing it:

```sh
CLISBOT_HUB_URL=https://hub.example.com CLISBOT_HUB_API_KEY=clisbot_pk_... clisbot hub connect
```

Origin precedence is explicit `[origin]`, `CLISBOT_HUB_URL`, then active stored login; with none of these it stops and asks for a Hub URL. An explicit `--api-key <secret>` takes precedence over `CLISBOT_HUB_API_KEY`. Stored CLI credentials are not used for connection.

Check and undo:

```sh
clisbot hub status
clisbot hub disconnect
clisbot hub disconnect --force   # drop local authority when Hub is unreachable
```

One daemon has one Hub relationship. Repeating `connect` for the same Hub reuses it without changing permissions; connecting to a different Hub requires an explicit disconnect first.

`clisbot hub logout` removes the active CLI login. The daemon's relationship is a separate identity and stays connected.

In an interactive terminal, logout offers to disconnect a daemon enrolled with the same Hub. Accepting disconnects first and then deletes the login, so a failed disconnection keeps your credential. Declining removes only the login.

Noninteractive and `--json` logout never disconnect implicitly:

```sh
clisbot hub logout --disconnect-daemon           # remove both identities
clisbot hub logout --disconnect-daemon --force   # drop local authority when Hub is unreachable
```

## Let Hub run agents on it

Enrolling a daemon does not let Hub start agents on it. That is the separate `hub.execute` permission, which login asks about and defaults to no. Grant it from the machine at any time:

```sh
clisbot hub permissions list
clisbot hub permissions grant hub.execute
clisbot hub permissions revoke hub.execute
```

Until it is granted, Hub keeps the daemon for identity and presence only. The Daemons page shows it as **Connected only** with the grant command, and Home's checklist reads **Cannot run agents**. [Hub security](/docs/hub/security#choose-daemon-authority) covers what the permission allows once granted.

## Reference it from configuration

```yaml
environments:
  dev:
    kind: daemon
    daemon: my-macbook
    cwd: /Users/you/code/your-repo
```

`daemon` accepts the friendly slug or immutable ID within the same organization. It resolves to the immutable daemon ID when the configuration activates, so a daemon that no longer exists fails activation instead of failing at dispatch.

`cwd` is a path on that machine. Hub does not clone anything for you; the directory must already exist.

To keep executions off your working tree, add a worktree:

```yaml
worktree:
  mode: branch-off
  newBranch: trigger-${{ clisbot.execution.id }}
  base: origin/main
```

`${{ clisbot.execution.id }}` renders the execution's UUID, so every execution gets its own branch off `origin/main`.

[Environment fields](/docs/hub/configuration/hub-yml#environments) lists what `newBranch` accepts. See [Git worktrees](/docs/worktrees) for setup hooks and scripts.

## What Hub owns

For agents it dispatched, Hub owns creation, reconnect recovery, output observation, and completion. Agents you start yourself are untouched.

If Hub loses the create response, or the daemon restarts mid-execution, Hub resends the same create intent with the same execution id. The daemon returns the existing agent rather than running the prompt again. An agent that closed or errored is recorded as interrupted; Hub never silently starts a second one.

## Status

| Status            | Meaning                                        |
| ----------------- | ---------------------------------------------- |
| Approval required | The CLI is waiting for you to approve the code |
| Connected         | Online and accepting dispatch                  |
| Offline           | Enrolled but not currently connected           |
| Revoked           | Access removed from Hub                        |

An event that arrives while a daemon is offline fails dispatch with `daemon_not_connected`. Nothing is queued for later. The event is in the project's Activity, and the trigger has to fire again. An offline daemon also blocks saving a trigger that changes its target or agent, because Hub checks that agent against it; see [Saving checks the agent against the daemon](/docs/hub/triggers#saving-checks-the-agent-against-the-daemon).

Revoking from **Daemons → Revoke daemon** ends the relationship from Hub's side. The daemon keeps running your local agents.

## Advanced CLI login

Use `hub login` only when intentionally granting durable CLI administration access, such as configuration export or supported API operations. It grants all five Public API scopes, has no automatic expiry, and does not add a Host. Read [API authentication](/docs/hub/api#authentication) before using it. `hub logout` only removes the local credential; revoke it in Hub → Configuration → API keys to end its server-side authority. Credentials from older onboarding versions remain valid until revoked.
