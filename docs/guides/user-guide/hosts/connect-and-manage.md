# Enroll and manage Hosts

[User guide](../README.md) · [Managed Access](managed-access.md) · [Q&A](../help/faq.md)

## Enroll a daemon in the Hub

On the machine running the daemon, use the command under **Add a Host** in **Settings → Hosts**, or:

```sh
clisbot hub connect https://hub.example.com
```

The daemon must be running. The terminal prints a URL that already contains the approval code; open it on a device signed in to the Hub (you do not type the code), check the **Host**, **organization**, **code**, and **Hub permissions on the Host**, then approve. An Owner/Admin of the organization does this approval. The command registers the Host itself and returns the current state; if it is still `connecting`, the daemon keeps connecting in the background and the approval page waits until the Host appears. There is no `login` step before it and no second confirmation prompt.

The approval code expires after 10 minutes. The enrollment token works only for the approved Host identity and permission set, is single-use, and expires with the request. The daemon keeps its own connection credential; **no CLI admin credential is created or stored**. By default it grants `hub.execute`, `daemon.read`, `workspace.read`, `workspace.write`, `workspace.manage`; use `--permission <permission...>` to choose a different set. These are the Hub's permissions on the Host; user access to Hosts/Projects is still configured in Access.

The flow is the same in a regular terminal, with `--json`, and with Docker `exec -T`: you still approve on the web, then the CLI continues on its own. Keep the command running while you approve, then let it finish. Follow the result in Hub → Hosts. Running `connect` again with the same Hub does not register another Host; after enrollment, though, `connect`/`hub status` need a daemon connection that already has permission (local IPC or a Managed Access ticket). For a different Hub, `disconnect` explicitly first. If the approval result is lost before the token reaches the daemon, run `connect` again to get a new code.

For installs without anyone to approve, pass an API key with the `daemons:enroll` scope through `CLISBOT_HUB_API_KEY` (or `--api-key`). `connect` does not reuse credentials from an earlier `login`.

Hosts already saved in the app (for example a direct `localhost` connection) are attached to the Hub right away and keep their name and existing connection. Signing out of the Hub removes only the Hub part; saved Hosts stay.

The daemon currently publishes connection info to the Hub only when relay is on. New daemons have relay off by default; if a Host is registered but lacks connection info, turn relay on in the daemon configuration (Docker: `CLISBOT_RELAY_ENABLED=true`, then recreate the container with the same volume). This configures the connection path; no extra CLI sign-in is needed.

In a Host's **Connections**, the connection the Hub provides (usually Relay) says **Provided by Hub** and has no Remove button, because the Hub would add it back. Connections you saved yourself can still be removed.

**Settings → Hosts** and the Host picker follow the same rule: they show Hosts you added directly and Hub-managed Hosts the current account may use. Direct or Relay is only the connection path; it does not decide permissions. Hub-managed Hosts from other accounts or organizations do not show; while a new account's permissions are loading, the app does not show those Hosts yet. Offline Hosts still show so you can open their settings and reconnect. A Host with several connection paths shows once. A Host registered on the Hub without connection info shows as pending in Settings → Hosts; you cannot pick it to work in yet.

The same rule applies to the Host pickers in New Workspace, Sessions, and Schedules. While the list loads, the picker shows **Loading Hosts…** and does not pick another Host or switch to Add Host on its own; if loading fails, click **Retry**. A Settings URL or old workspace for a Host you no longer have access to reports it as unavailable instead of opening that Host's content.

When you open a workspace, a Host already known to be offline is reported right away. A managed Host you have no access to tells you how to request access; a failure to load the permission list is reported separately. If connecting or loading the workspace has no result after 20 seconds, the app shows a timeout message with **Retry** and **Manage host**. Retry on a connection recreates that Host's connection; Retry on permissions reloads the list from the Hub. The app keeps the URL so you can continue when the Host is ready, and does not switch to another Host on its own.

Each daemon is its own Host, identified by the `serverId` in its `CLISBOT_HOME`. Two daemons on the same machine (for example the installed and dev builds) are two Hosts and can have the same machine name; rename them to tell them apart.

The Hub reports **Host "…" already uses this daemon's identity** when `CLISBOT_HOME` was copied from another machine (moving machines, cloning a VM, a Docker image). On the copied machine, run `clisbot daemon stop`, `clisbot daemon reset-identity`, `clisbot daemon start`, then `clisbot hub connect <Hub-URL>` again. The old Host stays on the Hub as offline; the Owner deletes it if it is not used.

If a Host shows **Offline** in **Settings → Hosts**, click **Reconnect**. If it stays offline, check that Clisbot is running on that machine, then open **Connections**.

## After connecting

The approval page always has **Home** and **Settings**, even while waiting for the Host to connect. When the Host appears, choose the next step:

- **Create a Bot**: opens the Bot form on the Host you connected; a Bot gets its own workspace, so you do not need to add a Project first.
- **Add a Project**: choose a docs or code folder on the Host. **Browse folders on Host** lets you browse level by level; see the [Project guide](../work/projects-and-workspaces.md#create-a-project).
- **Add another Host**: choose managed through the Hub, or direct.
- **Continue to Home**: go into the app; you can set things up later.

Create actions appear only when the Host is online, supports the feature, and you have the matching permission. Closing the form or skipping Add Project does not lose the connected Host. Resizing the window or switching between desktop and mobile layouts keeps the approval result for the current session and the selected folder.

## `login`: only for advanced CLI permissions

**Do not use `hub login` to add a Host.** Use it only when you deliberately want to give the CLI admin API permissions, for example to export configuration or use the supported admin APIs. Read [credential scope and lifecycle](../../../hub.md#advanced-cli-login) before running it.

`login` currently grants all five scopes `projects:read`, `configuration:validate`, `configuration:install`, `runs:dispatch`, `daemons:enroll`; it is not a permission to enroll one Host only. The credential does not expire on its own and stays valid until revoked on the Hub. `hub logout` only deletes the local copy and **does not revoke the credential on the Hub**. Tokens from earlier logins keep working after an upgrade; if you no longer need them, an Owner/Admin revokes them in Hub → Configuration → API keys.

Each daemon has one Hub relationship at a time, independent of CLI credentials.

## Rename a Host

**Shared name on the Hub:** **Settings → Hosts → [Host] → Rename**, enter the name, and save. Disconnecting the Host from the Hub is in that Host's **…** menu (**Disconnect**). You need permission to manage organization resources (Owner/Admin); Daemon Administrator alone cannot rename the Hub record.

The initial name comes from the machine's hostname, normalized to a lowercase slug with accents removed and separators replaced by `-`. If that is empty, `daemon-<ID prefix>` is used; on a collision, part of the ID is appended. New names are normalized the same way and must be unique in the organization.

Renaming does not change the daemon ID, the OS hostname, or the network address. Configuration that references the ID keeps working; review hand-written configuration that references the old name/slug.

**Your own name on your device:** Settings → **Hosts → [Host] → Appearance → Name**. This is a local label and does not rename the Host on the Hub for everyone. Your custom label stays when the Hub name changes.

## Many Hosts, many Projects

1. Enroll each daemon separately; give them recognizable names such as `dev-long`, `build-team`, `staging`.
2. Register each Project on the Host that holds its folder. Two Projects with the same name on two Hosts are two different resources.
3. Grant Connect per Host, then grant permissions per Project. Access on Host A does not extend to Host B.
4. Turn on `external` separately on each daemon that needs access control. Check the Host and path before creating a Workspace or running an Agent.

If you run several daemons on the same machine, give each its own configuration/data folder (`CLISBOT_HOME`) and endpoint. Do not copy a daemon's identity or credentials to create a second Host.

## Unenroll

On the daemon machine:

```sh
clisbot hub disconnect
clisbot hub status
```

Or use the Host's **Disconnect** in the Hub configuration, when your account has both organization configuration rights and the needed daemon admin rights.

Disconnect removes the enrollment, revokes the related connection permissions, and interrupts work that depends on the Hub. The app removes Hub-managed Hosts, with their workspaces, when the daemon leaves the Hub list; Hosts you added yourself stay. It does not delete your source folders. To use the Host again, enroll it again and check Access and any configuration that depends on it.

If the Hub cannot be reached, `clisbot hub disconnect --force` cleans up the local relationship. It does not confirm that the Hub revoked the credential remotely; clean up or revoke the record on the Hub once you can reach it again.

`clisbot hub logout` removes the CLI sign-in; it does not unenroll. If the CLI asks whether to disconnect as well, only that choice removes the daemon relationship.
