# Q&A and troubleshooting

[User guide](../README.md)

## Onboarding and startup errors

The commands below use the example home `~/.clisbot-dev-01`; replace it with your real home. Not set up yet: read [onboarding](../getting-started/onboarding.md).

| Symptom                                               | Check / fix                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Environment variable missing, email empty             | Load `.env` into the shell before running; editing the file does not change the environment of a running Hub. Do not print tokens/passwords to check them.                                                                                                                                 |
| `Select the existing organization owner...`           | `--owner-email` must be the owner of the right organization. No account yet: finish Account setup at the Hub URL, or bootstrap email/password on a new home. If the code was recently updated, build and restart the right Hub before retrying.                                            |
| Passed `--owner-password` and still get a conflict    | This flag does not replace the existing owner or password. Check the email, home, running Hub and build; do not delete data to get around the error.                                                                                                                                       |
| `Managed access ticket required` / home is `external` | This home has Managed Access on. Connect from an app that is signed in to the Hub and has access, or use the local socket/pipe admin path. The owner password does not replace a daemon ticket. See [Managed Access](../hosts/managed-access.md); to test from scratch, pick another home. |
| Port busy / will not start                            | A new home picks another port when the default one is busy; a saved home keeps its old port. Free the right port or set a port explicitly; do not stop another home by mistake.                                                                                                            |
| Slack connected but no reply                          | Check that the owner is linked, the bot is in the channel, the message has an `@mention`, Slack events/scopes are set, and Codex is signed in on the daemon machine. A successful outbound test does not prove the inbound path works.                                                     |
| New command/flag not recognized                       | Rebuild and use `./packages/cli/bin/clisbot` from the repo; check you are not calling an old global CLI.                                                                                                                                                                                   |

**Lost or expired `/link` code:** run the command below again. If the owner is not linked yet, the Hub issues a new code valid for 10 minutes and invalidates the old one; no token needed. If the owner is already linked, nothing changes.

```bash
clisbot bot start --home "$HOME/.clisbot-dev-01"
```

A bot with a different name needs `--bot-name`; `bot status NAME --home ...` also prints the command to get a new code. An old code cannot be read back from a file.

### Hub is running but the Clisbot web app will not open

The **Hub** URL and the **daemon** URL are two different addresses. Use the actual address printed; do not assume every home uses port 6868/6868.

```bash
clisbot daemon status --home "$HOME/.clisbot-dev-01"
clisbot daemon restart --home "$HOME/.clisbot-dev-01" --web-ui
```

You need the web assets (`npm run build:daemon-web-ui` if running from source). Open the daemon's HTTP origin after the restart. `CLISBOT_WEB_UI_ENABLED=true` on the init command does not change the config of a daemon that was already running.

If localhost opens but the Tailscale/proxy URL does not, check the proxy target. For example, a `:8444/` URL that points to Expo `:8081` fails once that dev server stops, even while the Hub is running. Init does not fix the proxy or start Expo. For the built-in web UI, point to the right daemon origin with WebSocket support; keep the proxy config for separate Hub URLs as it is.

Read `hub.log` and `daemon.log` in the home; `daemon status` also prints the log paths. Mask secrets, link codes and private details before sending logs to support.

### Re-seed the template and overwrite existing files

```bash
clisbot hub init --home "$HOME/.clisbot-dev-01" --overwrite-template
```

For a custom-named bot, add `--bot-name BOT_NAME`. The command backs up old files to `<workspace>/.clisbot-template-backup-*` and then replaces the template files, **including USER.md, MEMORY.md and BOOTSTRAP.md**; the output shows the backup path. Files outside the template and symlinks are left alone. Restore any content you need from the backup before you keep chatting. The flag applies to this run only; later runs keep files as they are.

### Forgot or want to change your password

Follow [Password and recovery](../account/password-and-recovery.md). Running init again does not reset the password; stopping the Hub does not delete accounts, data or Managed Access.

## Signed in to the Hub, why is there no Host?

Signing in does not enroll the daemon. Run `clisbot hub status` on the right machine; if it is not connected, run `clisbot hub connect`. In the app, check you are on the right Hub/organization, then **Refresh Hosts**. A Member needs a Connect grant; an offline status also means checking the daemon and the network path.

## After enrolling, do I still need to configure providers?

Yes. The Hub credential authenticates you to the Hub; it does not sign in to Claude, Codex or any other provider for you. Check the provider and its sign-in on the daemon machine itself, then pick a valid Agent configuration in Project Access.

## Does turning on external need a restart?

No, a mode change applies immediately. The app must reconnect to get a Hub ticket. You only restart to load a new daemon build after a software update.

## After turning on external, an old app or pairing link cannot get in?

That app may not support Hub tickets, or the signed-in user lacks Connect. Use an app that supports Managed Access, sign in to the right organization, check the grant and reconnect. LAN/Tailscale/SSH tunnels do not bypass the ticket requirement. If you lose the admin path, the operator uses the local socket/pipe to check the config.

## With off, can every upstream Clisbot app get in?

A compatible app can use the trusted pairing path if it has the full connection details and meets the endpoint requirements. Knowing the address is not enough. Hub Project Access does not limit that trusted session, though; use `external` when you need per-user access.

## What can I do with Connect only?

With `external`, Connect lets you connect to the daemon; to do any work you also need Project Access. With `off`, a trusted connection carries the daemon owner's access, so there are none of the Project limits a Hub admin might expect.

## I see the Host but not the Project?

Check that the Project grant belongs to the right Host, the Member has joined the Team, and the app has received the new access. Connect does not grant every Project. Test with a Member account, because the Owner always has wider access.

## Grant every Project on a Host but only some models?

Pick the Host itself as the resource, the **Developer** or **Office worker** level, then pick the Agent configuration. Do not use Administrator: Administrator ignores provider/model limits. See [grant every Project on a Host](../access/members-and-teams.md#grant-every-project-on-a-host).

## The Project grant allows only Claude, why can the person still use Codex?

Grants add up. If the Host already grants Codex, the Project grant only adds Claude; it does not remove Codex. To restrict, narrow the choices on the Host.

## An Agent waits forever for a tool approval (WebFetch, MCP…) that nobody can approve?

Older builds had no permission that could approve tools outside the file/config/command groups. Update and restart the Hub and **every daemon** first, then Edit assignment and pick Developer or Full access again to get the `approval.other` permission. In the reverse order, old daemons reject the ticket and the person cannot get in.

## After updating, the Agent no longer runs unattended?

Grants saved before the update lack `approval.other`, and running without approval prompts needs every approval permission. Update every daemon first, then Edit assignment, pick the access level again and save. See [after a version update](../access/permissions.md#6-after-upgrading).

## Can Developer create a new Project?

No. Grant **Full access** instead of Developer: on a Host it can create Projects in any folder; on a Project it can only create inside that Project, and a child Project needs its own grant before anyone can use it. To create and use a Project right away, grant Full access on the Host. Administrator is not needed, and provider/model limits still apply. Full access can also manage other people's Projects and workspaces, so read [what granting it implies](../access/permissions.md#4-consequences-to-know-before-granting).

## Developer still cannot create a Workspace/worktree?

An old grant may not include `workspace.create`. Update and restart the daemon first, then Edit assignment, pick Developer/Full access again and save. Check the Project, the Connect permission and the Agent configuration. If the daemon reports an unrecognized permission, that daemon version does not support the new ticket yet.

## Do a local Workspace and a worktree need different permissions?

Both use the Project privilege `workspace.create` today. It allows creating inside a granted Project only; it does not allow adding other Projects or archiving/deleting Workspaces.

## I can create worktrees but Git still errors?

If the error is about the repository, branch, path or lock, check that the repo is really a Git repo, the branch is not in use by another worktree, the target path is valid, and the account running the daemon can write there. A successful Access grant does not guarantee the Git operation succeeds.

## Can an Office worker start a new chat session and edit files?

Yes, in an existing Workspace, with `agent.create` and a granted Agent configuration. They can interact with the Agent and approve file operations. They get no terminal and no Workspace creation by default. Ask an Owner/Administrator to prepare the Workspace, or grant Developer if the work needs it.

## Why is a model missing, or why can't I create a session?

Check that the provider is working on the daemon and that the assignment has a complete Agent configuration: allowed provider/model/thinking. A Project grant alone does not open every model. Fast mode also needs its own grant.

## Does Resource not found always mean missing access?

No. The resource may have been deleted, the ID may be stale, or it may sit in a scope you are not allowed to see. When the code can tell the resource is one the user is allowed to know about but the action lacks permission, it returns **Access denied**. A resource outside that scope can still return **Resource not found**.

If the terminal shows an error, check that the Workspace still exists, the Project grant and `terminal.use`; Office worker has no terminal access. On an older build, update the app/daemon and reconnect to get the new permission messages.

## Why does Add Project report no access right away?

This check runs before the Project creation flow opens. Office worker and Developer lack this permission; you need Full access or Administrator. With Full access **on a Project**, the button still shows, but creating a Project outside that Project's folder is refused. If you were granted access recently, reconnect to refresh the session details.

## Does granting several Projects at once wipe the old config?

It can. If the person already has a grant on a selected Project, the old grant is replaced, Agent configuration included. The confirmation dialog lists the Projects being replaced; check it before you agree.

## I removed an assignment, why can the person still get in?

Check direct grants, every Team and the Owner role; access adds up. A grant on the **Host** also opens every Project on that Host: use **Resource · Who has access** on the Project to see those rows too. Check whether the daemon is `off` or the person still has another trusted pairing path. Revoke every source of access and check the connection again; signing out of one app does not revoke all access.

## Is a Daemon Administrator a Hub Admin?

No. Administrator manages an entire daemon: config, Projects, Agents, terminals, files/Git, access and local automation. Hub Admin manages the organization. See [the full scope](../access/daemon-administrator.md); note that an Administrator can run code with the daemon's OS permissions and change security config.

## Why doesn't the Administrator see the Managed Access switch or Rename Host?

The Managed Access switch in the app is open to the Organization Owner only, even though a Daemon Administrator's backend config permission is broad. Renaming the shared name needs Hub resource management (Owner/Admin). Check your organization role; if you only need a private label, use **Appearance → Name**.

## Renamed the Host but other places still show the old name?

Check whether you changed the shared name in **Settings → Hosts** or the local label in **Appearance**. A custom local label is kept. Refresh the list and review config that references the old slug; the daemon ID and the OS hostname do not change with Rename.

## Does logging out disconnect the daemon from the Hub?

Not automatically. CLI login and enrollment are separate. Use `clisbot hub disconnect` to unenroll; `--force` when the Hub is unreachable only guarantees the local cleanup, so check revocation on the Hub side afterwards.

## I have Channel access, why can't I call the Agent?

Check the Connection/conversation, that the Channel identity is linked to the right Member, Team membership and the route's audience. Then check that the route is on, the Host is online and the execution config is saved. Channel access does not grant opening the Project in the app.

## Automation does not run even with Run?

Run only allows requesting a run. Check that the Workflow is saved, the Host is online/enrolled, the Project/provider is valid, and the Hub service execution permission (`hub.execute`) is present if the flow needs it. Read the run's error to tell a permission refusal from a provider or step failure.

## Test message succeeds but real messages get no reply?

A test message checks the outbound path only. Check the inbound event/mention, that the route matches the conversation, identity/audience, and whether a run was created. If the run finished without replying, also check the route's delivery and the **Result** config of the reply step.
