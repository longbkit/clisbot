---
title: Hub quickstart
description: Create a Bot, connect Slack or Telegram with automatic Hub setup, and verify owner access.
nav: Quickstart
order: 61
category: Hub
---

# Hub quickstart

A Bot runs on your Host. **Hub & Channel connect** adds Slack or Telegram; creating a Bot for the app needs no Hub. These commands run on the Host machine with an installed, signed-in agent provider. The examples use Codex.

## Create a Bot

```sh
clisbot bot start
```

Choose a new or existing Bot. For a new Bot, choose its provider, then **Skip — use the Bot in the app** or select a channel. To name a new Bot explicitly:

```sh
clisbot bot start --bot-name "Sandbox Assistant" --provider codex
```

Choose **Skip** when asked about a channel. Without channel options, non-interactive execution creates only the Bot and starts the Host as needed. No Hub or web UI is started.

The Host owns the Bot, Project and directory Workspace. The default Bot home is under `daemon.bots.root/<slug>`; use `--workspace /absolute/path` when creating it to choose another directory. Existing Bots retain their home. `--kind personal|team` selects starter instructions, preserving existing files. Clisbot home resolves from `--home`, then `CLISBOT_HOME`, then `~/.clisbot`.

## Connect that Bot to a channel

Choose one channel. Load its token variables into your shell, then run:

```sh
# Telegram
clisbot bot start "Sandbox Assistant" \
  --telegram-bot-token '${TELEGRAM_BOT_TOKEN}' \
  --owner-identity YOUR_TELEGRAM_USER_ID

# Or Slack Socket Mode
clisbot bot start "Sandbox Assistant" \
  --slack-app-token '${SLACK_APP_TOKEN}' \
  --slack-bot-token '${SLACK_BOT_TOKEN}' \
  --owner-identity YOUR_SLACK_MEMBER_ID
```

The selector accepts a Bot ID or unique Host-local name/slug. It reuses that Bot's provider and workspace. To create and connect in one command, replace the selector with `--bot-name "Sandbox Assistant" --provider codex`.

Channel setup starts the Hub backend when needed. A fresh personal setup needs no Hub-mode flag, account sign-in, web UI, proxy command or manual daemon restart. Tailscale is preferred by default. If unavailable, follow the repair guidance or explicitly choose relay with the printed command. Existing account/team Hubs keep their access policy.

Token flags accept a literal, quoted environment reference or private secret-file path. Credentials are encrypted in a Connection; saved Bot references contain no token. Existing Connections use `--slack-connection-id` or `--telegram-connection-id`.

### Verify the owner

New DM and group routes admit only the Bot owner; groups require a mention. Existing route policies are preserved. `--owner-identity` is the human channel user ID verified by the local operator, not the bot's ID. Remote Admin access does not authorize binding arbitrary identities.

You may omit the owner identity. Setup then reports pending verification and, when authorized, prints a one-time `/link` command. Send that exact command from the owner's channel account to the bot in a DM or supported group conversation. Ordinary prompts do not run until ownership is verified; the first sender does not become owner. For another owner's Bot, follow the sign-in/verification guidance instead.

Codes expire after ten minutes. For a lost or expired code, rerun the printed renewal command or `clisbot bot start "Sandbox Assistant"`; this reuses the saved Connection without tokens and invalidates the previous code. `clisbot bot status "Sandbox Assistant"` shows status and recovery guidance. Once transport and owner verification are ready, DM the bot or mention it in a group it has joined.

## Connect from the app or optional local web

In the published web, Desktop or mobile app, open the Bot's **Connect to a channel…** action. It remains available without Hub and guides setup on the selected Host, preserving the Bot selection. Starting Hub requires that Host's independent Owner access; Hub account access alone is insufficient. Follow the reported pairing, update or managed-Host recovery step.

For a local browser UI:

```sh
clisbot web start
clisbot web status
clisbot web stop
```

Open the printed Owner pairing link when required. Web can start before or after Hub; it shares the browser origin for backend requests without changing Hub's identity. Stopping web leaves Host, Bot and Hub running. See [Web UI](/docs/web-ui) for access and deployment details.

## Resume and recover

```sh
clisbot bot start "Sandbox Assistant"
clisbot bot status "Sandbox Assistant"
```

The saved Bot and Connection are reused. Channel failure retains the Bot for retry; each channel conversation gets its own session in the Bot workspace. Configuration belongs in the UI/API, not an exported Hub Project. `hub init` remains a legacy workspace-and-Hub bootstrap path; prefer `bot start` for the optional-channel flow.

Use `--home /path/to/home` consistently for separate installations. Each home owns its Host and optional Hub. Fresh setup selects available default ports and reports actual addresses; explicit ports must be free. Startup failures point to that home's logs.

`managedAccess.mode: external` alone does not prove enrollment. Actual Hub enrollment or retained managed-access state determines whether tickets are required. Existing managed Hosts keep their policy: use authorized access or the operator's Hub; do not clear enrollment or disable protection to bypass a startup check. A genuinely empty home can prepare personal Owner access, while an existing unprotected Host needs a planned pairing migration. See [Web UI](/docs/web-ui).

The following password operations apply to account-based Hubs, not normal personal device pairing.

## Change an existing owner's password

`--owner-password` only bootstraps a new account; rerunning init does not reset an
existing password. To change a password you still know, export the current and new
passwords as environment variables, then run:

```sh
clisbot hub password change --home "$HOME/.clisbot-dev-01" \
  --email "$OWNER_EMAIL" \
  --current-password '${CURRENT_OWNER_PASSWORD}' \
  --new-password '${NEW_OWNER_PASSWORD}'
```

The new password must contain at least 12 characters. This command signs in to the
existing Hub account API, changes the password, and revokes other sessions. It does
not store either password in the bot manifest. A temporary bootstrap password can
also be changed through the Hub's first-sign-in password screen. For a forgotten
password, use the optional master-password recovery below. Deleting a home or
changing bootstrap flags is not a password-reset procedure.

## Recover with a configured master password

Recovery is disabled by default. The Hub operator can set `CLISBOT_MASTER_PASSWORD`
in the **Hub process environment** to enable it. Use an independent randomly generated
secret of at least 32 printable ASCII characters without spaces (maximum 1024),
kept in a password manager or a
private service environment file outside agent workspaces. This is an instance-wide
secret: its holder can reset any existing password account in that Hub, not just
one organization owner. It is separate from `CLISBOT_HUB_CREDENTIAL_MASTER_KEY`.

For an interactive local shell, load it without putting the value in shell history:

```sh
read -rsp 'Hub master password: ' CLISBOT_MASTER_PASSWORD
printf '\n'
export CLISBOT_MASTER_PASSWORD
```

Start the Hub from that environment. If already running, restart **that Hub** to
load the setting (the daemon can stay running):

```sh
clisbot hub stop --home "$HOME/.clisbot-dev-01"
clisbot hub start --home "$HOME/.clisbot-dev-01"
```

An exported shell variable lasts only for that shell and its children. For service
restarts, configure it in the service's private environment. Changing or removing
it requires a Hub restart; an unset/blank value disables recovery. Invalid short
values fail Hub startup rather than silently enabling a weak recovery secret.

When needed, load the master password and the replacement password into your own
terminal, then use references so values are not exposed in process arguments:

```sh
read -rsp 'New account password: ' NEW_OWNER_PASSWORD
printf '\n'
export NEW_OWNER_PASSWORD
clisbot hub password reset --home "$HOME/.clisbot-dev-01" \
  --email "$OWNER_EMAIL" \
  --master-password '${CLISBOT_MASTER_PASSWORD}' \
  --new-password '${NEW_OWNER_PASSWORD}'
```

The replacement must be 12–128 characters and differ from the master password.
No old account password is needed. The CLI requires HTTPS for remote Hubs, permits
HTTP only for loopback addresses, and does not follow redirects. This is currently
a CLI/API recovery flow; there is no new web recovery form.

The Hub allows five recovery attempts per minute per process across all accounts
and returns `429` with `Retry-After` on excess attempts. Multi-replica deployments
should also rate limit this endpoint at their shared ingress. Reset updates the
existing password hash, removes browser sessions and OAuth access/refresh records,
and records an audit event for each current organization membership in one
transaction. Previously issued account OAuth JWTs cannot authorize a revoked
session after recovery. Sign in normally afterward. Account roles, bot credentials,
API keys, channel identities, workspaces and files are preserved; this is not a
full credential-compromise response.

`CLISBOT_MASTER_PASSWORD` is stripped from inherited agent/terminal environments,
including provider overlays. This reduces accidental exposure; it is **not OS
isolation**. An agent that can read your private environment file, inspect Hub
processes, or modify the Hub database still has that authority. Do not give bots
the recovery secret or ask them to perform recovery on your behalf.

## Explicitly replace the seed template

```sh
clisbot bot start "Sandbox Assistant" --home "$HOME/.clisbot-dev-01" --overwrite-template
```

This replaces bundled template files, including `USER.md`, `MEMORY.md`,
and `BOOTSTRAP.md`, with the selected personal/team defaults. Before each replacement,
the original is retained in a private `.clisbot-template-backup-*` directory inside
the workspace; the result prints that directory and the number replaced. Symlinks,
directories, and files outside the template catalog are preserved. The flag is an
operation for that invocation, not a saved preference: later starts preserve files
again. Restore any desired context from the backup before continuing conversations.
