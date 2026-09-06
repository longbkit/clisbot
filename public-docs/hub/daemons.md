---
title: Daemons in Hub
description: Enroll a machine with Hub, reference it from configuration, and understand what Hub owns once it is connected.
nav: Daemons
order: 63
category: Hub
---

# Daemons in Hub

A daemon is one of your machines running the Paseo daemon. Enroll it once with your Hub organization, then any project can reference it.

## Connect

Log in from the machine first:

```sh
paseo hub login https://hub.example.com
```

The CLI prints a URL and a verification code and opens your browser. The approved login is stored under `PASEO_HOME`.

In an interactive terminal, login then offers to finish setup: whether to connect this daemon, and whether to initialize and deploy a starter workflow. Both default to yes. Declining the connection prints `paseo hub connect <origin>; then paseo hub init`, since connecting alone leaves the project without a workflow. Declining only the starter prints `paseo hub init`. `--json` or non-TTY login only logs in. [Quickstart](/docs/hub/quickstart) walks through the questions.

Enroll the daemon on its own when you declined, or when the machine is already logged in:

```sh
paseo hub connect
```

`connect` uses the active login to request a single-use enrollment token. The daemon exchanges it for its own relationship credential; your CLI login is never stored as daemon authority.

Hub derives the daemon's initial slug from its hostname. If that slug is already used in the organization, Hub adds a short daemon ID suffix. You can rename the daemon later in Hub.

Each daemon has two identifiers: an immutable generated ID and a friendly slug. Hub normalizes slugs with lowercase words joined by hyphens, so `Build Studio` becomes `build-studio`. The dashboard shows the slug. Configuration accepts either the slug or the immutable ID.

You can rename the slug later without changing the daemon ID. Configuration referencing the slug must be updated after a rename; references using the immutable ID remain valid.

In Paseo, open **Account → Hosts → Rename** with an organization Owner or Admin account.
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

For unattended setup, pass an organization API key without storing it:

```sh
PASEO_HUB_URL=https://hub.example.com PASEO_HUB_API_KEY=paseo_pk_... paseo hub connect
```

Origin precedence is explicit `[origin]`, `PASEO_HUB_URL`, active stored login, then `https://hub.paseo.sh`. An explicit `--api-key <secret>` takes precedence over the environment and an exact-origin stored login.

Check and undo:

```sh
paseo hub status
paseo hub disconnect
paseo hub disconnect --force   # drop local authority when Hub is unreachable
```

One daemon has one Hub relationship. Connecting a daemon that already has one is refused.

`paseo hub logout` removes the active CLI login. The daemon's relationship is a separate identity and stays connected.

In an interactive terminal, logout offers to disconnect a daemon enrolled with the same Hub. Accepting disconnects first and then deletes the login, so a failed disconnection keeps your credential. Declining removes only the login.

Noninteractive and `--json` logout never disconnect implicitly:

```sh
paseo hub logout --disconnect-daemon           # remove both identities
paseo hub logout --disconnect-daemon --force   # drop local authority when Hub is unreachable
```

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
  newBranch: trigger-${{ paseo.execution.id }}
  base: origin/main
```

`${{ paseo.execution.id }}` renders the execution's UUID, so every execution gets its own branch off `origin/main`.

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

An event that arrives while a daemon is offline fails dispatch with `daemon_not_connected`. Nothing is queued for later. The event is in the project's Activity, and the trigger has to fire again.

Revoking from **Daemons → Revoke daemon** ends the relationship from Hub's side. The daemon keeps running your local agents.
