# Onboarding: your first Slack bot

[User guide](../README.md) · [Troubleshooting](../help/faq.md#onboarding-and-startup-errors) · [Password and recovery](../account/password-and-recovery.md)

Only need agents from the app, web or phone? See the [quick start](quick-start.md). Already on Clisbot 0.1.x? See [upgrade to v2](upgrade-v2.md).

You end up with a personal bot on Codex, a workspace seeded from templates, and data stored in `~/.clisbot-dev-01`. Run the commands below in Bash on the machine that will run the bot.

## 1. Prepare

- Install a CLI version that includes Clisbot onboarding. Codex must be installed and signed in on the **machine running the daemon**, as the same user that runs the bot.
- A Slack app with **Socket Mode** on, events/permissions set up to receive messages, and installed to the workspace. You need the app token and the bot token; see [Slack setup](../../../../public-docs/hub/self-hosting/slack-app.md).
- Copy [`.env.example`](../../../../.env.example) at the repository root to `.env` if it does not exist (`cp -n .env.example .env`), then fill in the variables below. Keep an existing `.env` if it is already configured:

```dotenv
SLACK_APP_TOKEN='xapp-...'
SLACK_BOT_TOKEN='xoxb-...'
OWNER_EMAIL='you@example.com'
INITIAL_OWNER_PASSWORD='replace-with-a-password-at-least-12-characters'
```

The CLI does not load `.env` itself. Load a file you trust into the shell before running:

```bash
chmod 600 .env
set -a
source .env
set +a
```

**If you run from the repository:** stay at the repository root and build after updating the code:

```bash
npm run build:server
npm run build:hub
npm run build:daemon-web-ui  # if you need to open the Clisbot app in a browser
clisbot() { ./packages/cli/bin/clisbot "$@"; }
```

The `clisbot` function uses the build you made, so you do not call a global install by mistake. Keep this terminal open for the next steps. A packaged build with all features needs no build step. For first-time dependency install, follow [development](../../../development.md).

## 2. Onboard

```bash
CLISBOT_WEB_UI_ENABLED=true clisbot hub init \
  --home "$HOME/.clisbot-dev-01" \
  --bot-type personal \
  --provider codex \
  --slack-app-token '${SLACK_APP_TOKEN}' \
  --slack-bot-token '${SLACK_BOT_TOKEN}' \
  --owner-email "$OWNER_EMAIL" \
  --owner-password '${INITIAL_OWNER_PASSWORD}'
```

Keep the quotes as shown: the CLI reads `${ENV_VAR}` itself for **tokens/passwords**; the email uses `"$OWNER_EMAIL"` so the shell expands it. Do not post tokens or output containing link codes in public chats.

The command starts the daemon and Hub if needed, creates the workspace + templates + initial agent, saves the Slack Connection and the owner access configuration. You do not export a file, edit it and deploy it.

## 3. Finish linking the owner

If the output shows **ACTION REQUIRED**, send the printed `/link ...` command to the bot privately from your Slack account. The code is **single-use and valid for 10 minutes**; the output shows the expiry time. Then DM the bot with your requests; in channels the bot has joined, use `@mention`.

If you know the owner's Slack Member ID for sure, add `--owner-identity YOUR_SLACK_MEMBER_ID` at init to skip the link step. The bot token does not prove who the owner is. A linked identity is kept; nobody else gains owner rights on their own.

**READY** means the owner is linked and the Slack connection has started. If you still see `SETUP INCOMPLETE`, follow the output's instructions; check the provider if the bot receives messages but cannot run them.

## Where is the data?

| Item                                            | Default                                                     |
| ----------------------------------------------- | ----------------------------------------------------------- |
| Hub home: data and configuration of the install | `--home` → `CLISBOT_HOME` → `~/.clisbot`                    |
| Personal bot                                    | `personal-assistant`; workspace `<home>/workspaces/default` |
| Team bot (`--bot-type team`)                    | `team-assistant`; workspace `<home>/workspaces/team`        |
| Another folder                                  | Choose with `--workspace /absolute/path`                    |

**Onboarding does not seed into the current folder (`cwd`) or directly into the OS `$HOME`.** The Project/Workspace here is managed by the **daemon**; the Hub has no "Hub Project". The worktree is seeded at the actual path the daemon returns. Several personal bots in the same default home share one workspace; pick a separate `--workspace` to keep their contexts apart.

Onboarding uses the Markdown set from `clisbot main`: the `default` layer, `customized/default`, and the `personal-assistant` or `team-assistant` variant. `BOOTSTRAP.md` tells the agent to work out the timezone from available context/tools and ask the user to confirm before saving; it does not require the Clisbot CLI. A new workspace has `AGENTS.md`, `BOOTSTRAP.md`, `IDENTITY.md`, `LOOP.md`, `MEMORY.md`, `README.md`, `SOUL.md`, `TOOLS.md`, `USER.md`. The Claude provider also gets a `CLAUDE.md → AGENTS.md` symlink; Gemini gets `GEMINI.md → AGENTS.md`. The template tells the bot to delete `BOOTSTRAP.md` after the first conversation; running onboarding again does not recreate it. By default onboarding only creates missing files and leaves existing ones untouched, old templates included. To replace existing files, use `--overwrite-template`, which backs them up first. Each conversation creates or resumes its own session in the workspace instead of sharing the initial agent.

## Run again, check, stop

```bash
clisbot bot start --home "$HOME/.clisbot-dev-01"
clisbot bot status personal-assistant --home "$HOME/.clisbot-dev-01"
clisbot bot stop --home "$HOME/.clisbot-dev-01"
```

- **Saved automatically**; this flow has no `--persist` flag and does not need one. Running again needs no token/password; it reuses the saved bot, workspace and Connection. `hub init` also resumes the saved bot.
- Omitting `--bot-name` selects `personal-assistant`; a team bot uses `--bot-type team`, and a bot with another name needs the exact `--bot-name`.
- Omitting `--owner-email` works only when the organization has exactly one owner. A new home with no account: pass email/password as above or finish Account setup at the Hub URL.
- `bot stop` stops **the Hub and every bot sharing that Hub home**; the daemon keeps running and data is kept. Stop the daemon too with `clisbot daemon stop --home "$HOME/.clisbot-dev-01"`.

## Open the app, configuration and variants

- The **Hub URL** in the output is for Account setup and configuration. The **daemon URL** serves the Clisbot web app when the web UI is on and web assets exist. Init does not start an Expo dev server or configure Tailscale/a reverse proxy.
- Change configuration through the UI/API. A restart does not overwrite templates or the owner password.
- Telegram: replace the two Slack flags with `--telegram-bot-token '${TELEGRAM_BOT_TOKEN}'`; the owner identity is the Telegram user ID. Load this variable into the shell first.
- Workspace only, no chat yet: `clisbot hub init --home "$HOME/.clisbot-dev-01" --provider codex`; add channels later.
- To try a fresh install, pick **a different, unused home**, for example `~/.clisbot-dev-02`; do not delete the old home.

## Use an existing Hub or join an organization by invitation

You do not need a new local Hub. In the app go to **Settings → Account** and sign in to your organization's Hub. Operators follow [connect a Host](../hosts/connect-and-manage.md), configure providers and add Projects on the Host; [Managed Access](../hosts/managed-access.md) is on by default, so Hub permissions take effect as soon as the Host joins the Hub.

A Member accepts the invitation with the right email → **Settings → Hosts** → picks the granted Host, Project and Workspace → creates an Agent session. If resources are missing, see the [Q&A](../help/faq.md). Invite people and grant access per [Members and Teams](../access/members-and-teams.md).
