# Upgrade from Clisbot v1 to v2

Use Node.js **22.19 or newer**. Clisbot v2 keeps the npm package name `clisbot`, the
`clis` alias, and the default home `~/.clisbot`.

After 2.0.0 is published, run:

```bash
npm install -g clisbot@2.0.0
npx --yes clisbot@2.0.0 onboard
```

The explicit `npx` version selects v2 even when `~/.clisbot/bin/clisbot` still
points at the old installation. For a separate home, add `--home /absolute/path`
to `onboard`. Use `--transport local --voice disable` to set up local access
without the transport and voice questions; omit these options for remote setup.

Open the pairing link printed by onboarding. Native provider logins such as your
existing Claude Code or Codex login stay in their own provider directories.

## What happens to the old home

V1 reads `clisbot.json`; v2 reads `config.json`. Both files can remain in the same
home. V2 does not rewrite the old file.

Onboarding and CLI daemon start prepare a v1 handover before launching v2:

- Back up the old config, monitor state, PID file, and ephemeral credential file
  into a private directory under `<home>/backups/`
- Stop the verified v1 monitor and worker with `SIGTERM`; abort if the PID cannot
  be proven to belong to v1 in this home or the process does not exit
- Create v2 launch profiles from supported provider/name choices if `config.json`
  does not exist; enable personal serving and device pairing, choose an available
  loopback port, and use Managed Access `off` for this personal home
- Preserve an existing valid v2 configuration byte-for-byte; back up an invalid
  `config.json` before creating a valid one, provided no v2 daemon is running
- Back up and replace a recognized v1 home wrapper
- Register existing agent working directories as Projects through the daemon
  without changing their files

Your code, `MEMORY.md`, `SOUL.md`, `USER.md` and other workspace files stay in
place. Existing instructions that reference old CLI commands need updating.

Read `<home>/v1-upgrade.json` for the backup location, stopped PIDs, registered
directories and settings still pending. The report does not contain tokens;
the private backup can contain credentials. The report is saved before shutdown and resumed after failure; directory
registration resumes after an interrupted launch. Starting a v1 process again
after preparation triggers another verified stop and a new backup; the original
backup and existing v2 config are preserved. `CLISBOT_V1_MIGRATION_ENABLED=0`
disables both preparation and registration.

If v1 is managed by an external service such as systemd or launchd, stop that
service first so it cannot restart v1. Custom v1 config/PID paths and unrecognized
wrappers require manual handover. The migration does not kill tmux sessions.

## Channel chat needs one further setup

Channel configuration is now owned by the Hub. The first v2 release does **not**
automatically import Slack/Telegram/Zalo Connections, Rules, sender permissions,
or the v1 owner/admin role assignments.

Open the Hub with `clisbot hub start`, finish Account setup, and create a
Connection with your existing channel credentials. Read tokens from their old
credential files or the private backup; do not paste them into logs. Set the
Connection's Rules to the old groups/DMs and allowed people before starting it.
Link the owner identity when onboarding asks for it. A bot token does not prove
the owner's identity.

Live tmux sessions, queued prompts, loops, pairing approvals, runner arguments,
custom provider environment settings and Zalo Personal login sessions are not
automatically converted. Provider-native history can be imported separately with
`clisbot import` when that provider supports the stored session.

## Recovery

If onboarding reports a handover failure, v2 is not launched; resolve the stated
process or file problem and run onboarding again. If v2 has started and later
setup fails, inspect `clisbot status` and `<home>/daemon.log` before retrying.

To return to v1, stop the v2 daemon and Hub, install the old npm version, and
restore the wrapper and ephemeral credentials from the private backup as needed.
The original `clisbot.json` and workspaces remain available. Changes made in v2
are not converted back into v1.
