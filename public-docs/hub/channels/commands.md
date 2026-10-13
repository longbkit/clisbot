---
title: Channel slash commands
description: Choose Projects and Workspaces, inspect Git, control sessions, and use the configuration your access allows from a channel.
nav: Slash commands
order: 81
category: Hub
---

# Channel slash commands

Commands control the session in the channel conversation where you send them. Start with `/help`. In a group, address the bot: `@clisbot /status`. In a DM, `/status` works. Commands and their replies stay in that conversation; other participants can see them.

A [Route and its Rules](/docs/hub/channels#rules-how-a-message-gets-in) decide who can chat. Chatting with its Agent gives you no access to the Host, Project or Clisbot app. [Managed access](/docs/hub/managed-access) supplies the personal permissions needed to choose a different location or configuration.

## Choose a Project and Workspace

A **Host** connects your app to the daemon that runs agents and holds files. A **Project** is a registered directory on that Host. A **Workspace** groups sessions working in one directory; it can use the existing checkout or a separate Git worktree. See [Workspaces](/docs/workspaces).

These commands need a direct Route already serving this conversation. They work before its first session starts; mentioning the bot cannot create a Route for an unserved topic.

| You want                                              | Send                                          |
| ----------------------------------------------------- | --------------------------------------------- |
| Current session and next session's location           | `/project` or `/workspace`                    |
| Projects you can use on this bot's Host               | `/project list`                               |
| Find a Project                                        | `/project search payments --page 2`           |
| Choose a Project; clear the Workspace choice          | `/project <project-id>`                       |
| Registered Workspaces in the selected/default Project | `/workspace list`                             |
| Only worktree Workspaces                              | `/workspace list --worktree`                  |
| Find by name, ID, branch or final folder              | `/workspace search login --worktree --page 2` |
| Inspect without selecting                             | `/workspace show <workspace-id>`              |
| Choose an existing Workspace                          | `/workspace <workspace-id>`                   |
| Return to the Route's Project and Workspace defaults  | `/project clear`                              |
| Keep the Project and clear only the Workspace choice  | `/workspace clear`                            |

IDs and unique exact names work for selections and Workspace `show`. Use IDs when names repeat. Project and Workspace searches match the final folder name, not parent folders. Each list/search returns up to **10 results** with counts and next/previous commands; add `--page 2` when another page exists. Workspaces show recent activity first. Projects show name order. Inaccessible Projects are excluded before searching and counting.

Bare `/project`, `/workspace` and `/branch` show **Current session** and **Next session**, including names, IDs and the Host. Workspace details include branch and full path. They show an uncreated Workspace as new, without inventing a title or worktree path.

### Create the Workspace before starting an Agent

```text
/project list
/project <project-id>
/branch list
/workspace new main
/new fix the flaky login test
```

`/workspace new main` creates and selects a worktree Workspace immediately. The Agent starts with `/new <message>`; bare `/new` clears the binding so the next accepted prompt starts it. For refreshed remote history, use `/branch fetch` then `/workspace new origin/main`.

```text
/workspace new origin/main --branch fix/login --name "Fix login"
/workspace new --local --name "Main checkout"
```

`--branch` preserves the branch name you specify; omit it for automatic naming. `--name` sets the Workspace title. Omit the base ref to use the Host's default branch choice. `--local` uses the Project's existing checkout and accepts `--name`, but cannot be combined with a base or `--branch`. A non-Git Project needs `--local`.

Selection changes the **next** session, leaving the running session in its current directory. The choice is shared by everyone in the Route's binding scope (thread, topic, or whole conversation) and persists across `/new` and Hub restarts.

- `/new` and `/quick` use the next-session choice; `/quick` leaves the current binding in place.
- `/fork` carries the current transcript and continues here. It uses an explicitly selected destination Workspace; when the destination Project changes without one, it creates there. Otherwise it continues in the source Workspace.
- `/side` stays in the source Workspace.
- `/resume` checks the existing session's actual Project and updates the next choice after attachment.

With no explicit choice, `/new` and `/quick` normally get a new Workspace named from the prompt, while `/fork` and `/side` reuse the source Workspace. The operator can disable automatic organization. If a choice expires after a Route or Host change, reselect or use `/project clear`; the refused prompt is not automatically retried.

### Location permissions

All location commands need `project.use`. Choosing or creating a destination also checks the following permissions and configuration grants:

| Action                                                        | Required access on the destination Project                      |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| Discover/inspect Projects, Workspaces, branches and worktrees | `project.use`                                                   |
| Select or clear a location                                    | `agent.create` and an allowed Agent configuration               |
| Create either kind of Workspace                               | `workspace.create`, `agent.create` and an allowed configuration |
| Refresh a Git remote                                          | `approval.command`                                              |

An inherited Route setting that creates a worktree also needs `workspace.create` in an explicitly selected Project. The Host must support Workspace commands and Git commands; an older Host asks you to update. An operator can disable the whole location-command surface for a Route with `workspace.commands: false`.

## Inspect Git and refresh branches

Use `/workspace` for creation and selection. `/worktree` inspects Git checkouts, including those that are not registered as Workspaces.

| You want                                           | Send                                    |
| -------------------------------------------------- | --------------------------------------- |
| Current/next branch and location                   | `/branch`                               |
| Local and remote-tracking refs                     | `/branch list`                          |
| Search refs, with pagination                       | `/branch search origin/ --page 2`       |
| Refresh `origin`                                   | `/branch fetch`                         |
| Refresh another configured remote                  | `/branch fetch upstream`                |
| Inspect this session's worktree                    | `/worktree`                             |
| All Git worktrees, including the primary checkout  | `/worktree list`                        |
| Find by branch, final folder, Workspace name or ID | `/worktree search login --page 2`       |
| Inspect without selecting                          | `/worktree show <path-or-workspace-id>` |

Branch and worktree lists show latest commit first, up to 10 per page. Branch refs retain their namespaces (`main`, `origin/main`, `upstream/main`). They include short hash, commit date in UTC and author. Lists use refs already on the Host; they never fetch implicitly.

Fetch uses the Host's Git credentials and updates remote branch refs. It preserves local branches, tags, HEAD and working files. It needs command approval permission, even though listing does not.

Worktree replies include Host, Project, branch, full path, associated Workspace, file-status counts and latest commit; `show` includes the commit subject. Counts exclude ignored files and reveal no filenames or diffs. Dirty files do not change list ordering. Before a session, bare `/worktree` inspects the chosen/default Workspace or the Project root with no Workspace selected. Replies distinguish **local (Project root)** from **worktree**. When several Workspaces share a checkout, list/show by path reports their count; `show <workspace-id>` identifies one association.

## Start, stop and guide sessions

| You want                                | Send                        |
| --------------------------------------- | --------------------------- |
| Fresh session; next prompt starts it    | `/new` (`/reset`)           |
| Fresh session with a first prompt       | `/new fix the login test`   |
| Continue an existing session here       | `/resume <agent-id>`        |
| Copy the transcript and continue here   | `/fork [message]`           |
| One-off with the transcript             | `/side <message>`           |
| One-off without context                 | `/quick <message>`          |
| Stop the turn or active Automation runs | `/stop` (`/cancel`)         |
| Nudge a running turn                    | `/steer <message>`          |
| Send after the current turn ends        | `/queue <message>`          |
| Open the same session in the app        | `/cowork` (`/open`, `/app`) |

`/resume` needs `agent.create` and access to the target session's Project and configuration; a session bound to another conversation cannot be resumed here. Forking needs a Host that supports copying session context. One-off sessions send their answer here and auto-archive. Queued messages run in order, one per turn; detaching the session or restarting the Hub clears them.

On an **Automation** Route, `/stop`, `/status`, `/me`, `/help`, `/cowork`, `/followup` and approval replies apply. Location, session creation, configuration and extension commands require a directly bound Agent; the bot reports when a command is unavailable.

`/cowork` needs `agent.interact`. It returns browser and installed-app links when your operator configured the app web origin; otherwise it returns a copyable `clisbot://` URL. Opening a link still needs your own Host access.

## Choose an Agent configuration

| Choice                                             | Send                                                         |
| -------------------------------------------------- | ------------------------------------------------------------ |
| Agent profile (provider, model, mode and thinking) | `/agent list`, `/agent search review`, `/agent <name>`       |
| Provider                                           | `/provider list`, `/provider search codex`, `/provider <id>` |
| This provider's models                             | `/model list`, `/model search sonnet`, `/model <id>`         |
| This model's effort levels                         | `/effort list`, `/effort <id>` (`/thinking`)                 |
| Provider's permission mode                         | `/permission list`, `/permission <mode>` (`/mode`)           |

A bare configuration command shows the current and next-session choices without changing them. Add `list` or `search <text>` to discover options. Choices are bounded by your `agent.interact` access and provider/model/thinking grants. Models and effort levels belong to their current provider and model; a cross-provider model choice is refused.

Same-provider model, effort and mode changes apply live. A different provider is **staged** while ordinary messages continue to the running session. Use `/new` to start clean or `/fork` to carry context into that provider. While a provider is staged, configuration commands edit that next choice. Unattended modes need the matching `approval.*` privilege. Fast mode also needs `agent.fast.use`, including through a profile or resumed session.

`/routedefault` shows the serving Route and its default. `/promoteroutedefault` makes this conversation's configuration the default for future sessions on that Route; `/promoteroutedefault undo` restores its previous default. Promotion needs `channel.manage` (Connection Manage access); running sessions keep their setup.

## Skills, shortcuts and follow-up

Use `/skill list`, `/skill search <text>` or `/skill <name>` to discover or run an Agent skill. `/command list`, `/command search <text>` and `/command <name>` discover or run account-shared shortcuts.

```text
/command add standup summarize today's changes and blockers
/standup
/command remove standup
```

Adding/removing shortcuts needs `approval.config`. Platform command names are reserved; `/skill <name>` explicitly invokes a skill even when its name collides. Unknown slash words pass through as Agent prompts when addressed to the bot.

`/followup` shows whether plain messages need a mention in this conversation. `/followup auto` allows unmentioned follow-up for 5 minutes after the Agent's latest activity, unless your operator set another duration. `/followup mention-only` requires a mention each time; `/followup pause` pauses until the next accepted mention; `/followup resume` restores the Route's setting. In Slack, send it inside the thread you want to change.

`/followup route` shows the Route's setting. `/followup route auto 10` or `/followup route mention-only` changes it for all conversations and needs `channel.manage`. Conversation overrides persist until `/followup resume`; the active follow-up window is lost on Hub restart.

## Identity and approvals

`/status` (`/state`) shows chat/thread/topic IDs and whether you can talk here. An admitted, linked Hub Member also sees session details. `/me` shows your sender ID and linked Member's access. In Telegram and other channels that hide group members' IDs, send `/me` in a DM. Give these IDs to an admin when asking for access. Use [`/link <code>` from the Managed access identity-linking flow](/docs/hub/managed-access#link-your-chat-account) to connect your channel identity to your Hub Member.

`/help`, `/me` and `/status` answer anyone by default, including senders a Rule refuses. The operator can restrict them to admitted senders/managers. Other chat controls need Route admission; configuration, location and approval commands additionally check the permissions described above. An unlinked identity uses the Guest group's grants, which are empty by default.

`/approve` allows the newest pending permission request; `/approve <id>` targets one. `/deny [id]` refuses it. Answer an Agent question with `/approve <id> use the staging database`. Permission approvals need the open prompt's authority; questions can be answered by participants the Route admits. Buttons work where supported; [WhatsApp](/docs/hub/channels/whatsapp) also uses reactions.

If an acknowledgement is lost or the bot reports an interrupted command, inspect `/status` or the app before sending a new command message: the first may already have changed the session.

## Channel invocation

Send one complete command message. A command inside surrounding prose is an ordinary Agent prompt. `/`, backslash and bare verbs share the parser, but channel clients can intercept slash text.

| Channel                                                                               | Invocation                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Slack](/docs/hub/channels/slack)                                                     | `/clisbot status` when the native umbrella is configured; in a channel use `@clisbot status` or `@clisbot \status` to avoid native-name collisions.                          |
| [Telegram](/docs/hub/channels/telegram)                                               | DM: `/status`. Group: `/status@yourbot`, `@yourbot /status`, or the mobile glued `@yourbot/status`. Bare group `/status` names no bot and is ignored.                        |
| [Discord](/docs/hub/channels/discord)                                                 | Native `/clisbot` with its `command` text option set to `status`; acknowledgement is private, command output goes to the conversation. Or mention the bot with command text. |
| [Google Chat](/docs/hub/channels/googlechat)                                          | `/clisbot status` after operator registration in the app console; otherwise command text, mentioning the app in a space.                                                     |
| [Feishu / Lark](/docs/hub/channels/feishu)                                            | Type command text and mention the bot in a group. `@everyone`/`@all` does not address it.                                                                                    |
| [Zalo Official Bot](/docs/hub/channels/zalo)                                          | Type `/status` in the direct chat; no native slash menu.                                                                                                                     |
| [Zalo Personal](/docs/hub/channels/zalouser), [WhatsApp](/docs/hub/channels/whatsapp) | Type command text; address the bot/account in a group.                                                                                                                       |

Several bots can share a room, so outside a DM a command must name this bot even when ordinary messages have a follow-up window. Typed approval answers are exempt: they target a prompt the bot posted and stay silent when it has none. Platform-specific transports and live evidence remain on each channel's page; shared syntax does not establish live verification.
