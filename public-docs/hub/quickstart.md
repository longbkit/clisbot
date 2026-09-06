---
title: Hub quickstart
description: Create a seeded assistant workspace and connect Slack or Telegram through Hub APIs.
nav: Quickstart
order: 61
category: Hub
---

# Hub quickstart

`paseo hub init` creates a local assistant workspace with starter instructions and an initial agent you can open in the app. Supply channel credentials to also enroll the daemon, configure a Connection and member routes, and prepare owner access. Configuration is updated through APIs.

You need Paseo installed and an available agent provider on the daemon. The examples use Codex; select another configured provider with `--provider`.

## Create your assistant workspace

```sh
paseo hub init --provider codex
```

The command starts the local daemon and Hub as needed. Its default directory is `<Clisbot home>/workspaces/default`, regardless of the directory from which you run it. Home resolution is `--home`, then `CLISBOT_HOME`, then `PASEO_HOME`, then `~/.clisbot`. `~` in a configured home is expanded. Use `--workspace /absolute/path` to select another directory.

The daemon owns the **Project** and **Workspace**. Hub has no Project to create or select. For worktree isolation, templates are written into the actual worktree directory returned by the daemon.

The personal or team template (`--bot-type personal|team`) creates missing `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, `IDENTITY.md`, `BOOTSTRAP.md`, and `TOOLS.md` before creating the agent. Existing files and symlinks are preserved by default and counted in the result. The OS home root cannot be used as the seed destination. Team assistants default to `<Clisbot home>/workspaces/team` so they do not share the personal assistant’s files. Choose an explicit separate workspace for any other assistants that must not share context. Existing saved workspace paths are preserved.

## Configure the owner and a channel

Open the local Hub address printed by the command and finish Account setup. For a fresh unattended installation, supply `--owner-email` and `--owner-password '${INITIAL_OWNER_PASSWORD}'` to the first command; set the password in that environment variable beforehand. `--organization-name` optionally names the initial organization. Existing accounts and passwords are preserved.

For Telegram:

```sh
paseo hub init --provider codex \
  --telegram-bot-token '${TELEGRAM_BOT_TOKEN}' \
  --owner-email you@example.com \
  --owner-identity YOUR_TELEGRAM_USER_ID
```

For Slack Socket Mode:

```sh
paseo hub init --provider codex \
  --slack-app-token '${SLACK_APP_TOKEN}' \
  --slack-bot-token '${SLACK_BOT_TOKEN}' \
  --owner-email you@example.com \
  --owner-identity YOUR_SLACK_MEMBER_ID
```

Token flags accept a literal, a quoted environment reference, or a private secret-file path. Slack verifies both tokens through its existing Application setup and stores an encrypted Connection. Existing Connections can be selected with `--slack-connection-id` or `--telegram-connection-id`.

`--owner-identity` is the human provider user ID explicitly asserted by the local operator. A bot token identifies the bot, not its human owner. If the owner already has a verified identity on this Connection, it is reused. Otherwise omit the flag and send the private, one-time linking command printed by onboarding to the bot from the owner's account. Codes expire after 10 minutes; the CLI shows the exact expiry and remaining time. No manual route or permission grant is then needed. Lost or expired codes cannot be retrieved in plaintext: rerun `bot start` using the renewal command printed in the result to issue a new code without channel tokens. Issuing a new code invalidates the previous one. `bot status personal-assistant` also prints the recovery command.

When the owner is linked and transport is started, DM the bot or mention it in a group/channel it has joined. Group/channel routes require a mention. Slack channel replies use a thread under the request. Other senders do not acquire owner access. A pending transport or pending identity link is reported explicitly.

## Run again and update configuration

```sh
paseo bot start --bot-name personal-assistant
```

The saved manifest reuses the workspace, initial agent, and encrypted Connection; it contains no channel token. `hub init` also resumes a saved bot. A failed channel install retains the daemon resource IDs for retry. Existing user files and unrelated routes are preserved.

Channel conversations create or resume their own agent sessions against the configured workspace. They are not all attached to the initial agent visible in the app.

Use the Hub configuration UI or its resource APIs to change configuration. Export is optional backup/portability; editing exported files and deploying a Hub Project is not part of this flow. `CLISBOT_ONBOARDING_ENABLED=0` restores the inherited CLI setup surface for rollback; apply the same setting to the CLI and Hub.

## Multiple local homes

Each home starts its own daemon and Hub. On first setup, if a default loopback port is occupied,
onboarding selects another available port and prints the actual addresses. Background Hub
restarts retain the selected port and fail if another process has since taken it. An explicit `PASEO_LISTEN` or `hub start --port`
choice must be free. A supervisor PID alone does not mean the daemon is ready;
startup failures point to the selected home's logs rather than contacting another
home's server. An existing connection to a different Hub must be disconnected
explicitly before enrolling the daemon into the local Hub.

A home with `daemon.managedAccess.mode: external` is an existing managed installation,
not a fresh onboarding target. CLI onboarding stops before opening an unticketed TCP
connection. The Hub owner password does not replace the daemon access ticket. Use
an empty home for a fresh test, or use authenticated local socket/pipe recovery to
manage the existing installation. Stopping processes preserves this access policy.

## Change an existing owner's password

`--owner-password` only bootstraps a new account; rerunning init does not reset an
existing password. To change a password you still know, export the current and new
passwords as environment variables, then run:

```sh
paseo hub password change --home "$HOME/.clisbot-dev-01" \
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
paseo hub stop --home "$HOME/.clisbot-dev-01"
paseo hub start --home "$HOME/.clisbot-dev-01"
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
paseo hub password reset --home "$HOME/.clisbot-dev-01" \
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
paseo hub init --home "$HOME/.clisbot-dev-01" --overwrite-template
```

This replaces the nine bundled template files, including `USER.md`, `MEMORY.md`,
and `BOOTSTRAP.md`, with the selected personal/team defaults. Before each replacement,
the original is retained in a private `.clisbot-template-backup-*` directory inside
the workspace; the result prints that directory and the number replaced. Symlinks,
directories, and files outside the template catalog are preserved. The flag is an
operation for that invocation, not a saved preference: later starts preserve files
again. Restore any desired context from the backup before continuing conversations.
