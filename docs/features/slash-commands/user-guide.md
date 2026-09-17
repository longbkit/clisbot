# Slash commands — user guide

Type these in any channel where the bot is present — Slack, Telegram, Discord,
Feishu, Google Chat. They control the agent session bound to the conversation
you type them in. The full list and what each needs is the
[command reference](README.md#command-reference); this guide is how to use them.

## The short version

- `/help` shows every command in the conversation you're in.
- Outside a DM, mention the bot with the command (`@paseo /status`). Several bots
  can share a group, so a command that names no bot is ignored.
- Most commands act on **this conversation's** agent. `/new` starts one, `/stop`
  stops it, `/cowork` opens it in the Clisbot app.
- If a command needs a permission you don't have, the bot says so and does
  nothing — nothing changes silently.

## Move between the channel and the app

`/cowork` replies with a link that opens this conversation's agent session in the
Clisbot app, or the web app configured by your Hub operator. Use it to pick up the same session on your
phone or desktop and keep working, then come back to the channel — the session
is the same on both sides.

You get two links and pick the one that suits where you are — **Open in the web
app** opens a browser, **Open in the Clisbot app** opens the installed app. Both
need your Hub operator to have set the web origin; without it you get one bare
`paseo://` URL to copy, because a channel will not linkify that scheme.

Both are posted in the conversation you asked from, including a public channel.
You need `agent.interact` access there to get them, and opening one still
requires your own access to the Host — but anyone reading the channel sees them.

## Start, resume, and stop a session

| You want                                                  | Type                            |
| --------------------------------------------------------- | ------------------------------- |
| A fresh session, bound here                               | `/new`                          |
| A fresh session with a first message                      | `/new fix the flaky login test` |
| To continue an existing session here                      | `/resume <id>`                  |
| To stop the current turn (or cancel a running automation) | `/stop`                         |

`<id>` is the agent id shown by `/status` or in the app's URL. `/resume` replaces
whatever session was bound here before, after checking your access to the target. A session already bound to another conversation cannot be resumed here. Bare `/new` clears the binding; your next message starts the new session.

## Guide a running turn

- `/steer <message>` slips a message into the turn the agent is already running —
  a nudge without interrupting.
- `/queue <message>` holds your message until the current turn finishes, then
  sends it. Multiple messages are released in order, one per turn; an idle session
  starts immediately. Queued messages are held in memory and are cleared when the
  session is detached or the Hub restarts.

These apply to a directly-bound agent. In a conversation that runs an
**automation**, use `/stop` to cancel the run and just send a normal message to
start a new one.

## Keep talking without a mention

In a group, every message needs a mention by default. `/followup` changes that
for the conversation you type it in:

| You want                                                   | Type                     |
| ---------------------------------------------------------- | ------------------------ |
| To see the current setting                                 | `/followup`              |
| Messages to continue for a few minutes after the bot works | `/followup auto`         |
| A mention on every message                                 | `/followup mention-only` |
| A mention on every message until the next mention          | `/followup pause`        |
| The Route's own setting back                               | `/followup resume`       |

With `auto`, the window is counted from the agent's last turn (5 minutes unless
the operator set another value); after it, mention the bot again. The reply says
what changed: in a thread it is that thread, in a topic that topic. On Slack,
where each message at the channel root starts its own thread, type it inside the
thread you want to change.

To change it for every conversation on the route, you need `channel.manage`:

| You want                                                  | Type                           |
| --------------------------------------------------------- | ------------------------------ |
| The route's setting                                       | `/followup route`              |
| Every conversation to continue without a mention (10 min) | `/followup route auto 10`      |
| A mention on every message, everywhere on the route       | `/followup route mention-only` |

Conversations that set their own `/followup` keep it until `/followup resume`.

## Switch agent, provider, model, effort, and mode

The bot only offers the choices you're allowed — not the whole catalog. Any
participant with `agent.interact` and the required configuration grant can switch.
Creating a dynamic command needs `approval.config`; unattended modes need the
matching approval privilege.

| You want                    | Type                                                     |
| --------------------------- | -------------------------------------------------------- |
| Apply an agent profile      | `/agent`, `/agent <name>`                                |
| See / switch provider       | `/provider`, `/provider search codex`, `/provider codex` |
| See / switch model          | `/model`, `/model search sonnet`, `/model <name>`        |
| See / set effort            | `/effort`, `/effort high`                                |
| See / set mode (permission) | `/permission`, `/permission plan`                        |

An **agent profile** is a saved bundle (provider + model + mode + thinking);
`/agent <name>` applies one in a single step, and `/agent` lists the profiles you
may use. `/provider`, `/model`, and `/effort` tune one axis at a time, and
`/permission` sets the mode. A bare command shows the menu.

These three nest — a provider has its own models, and each model its own effort
levels — so the bot keeps them unambiguous: `/model` lists only the current
provider's models, `/effort` only the current model's levels, look-alike names show
as `provider/model`, and every change confirms the full setup ("Provider: codex ·
Model: … · Effort: …"). You can't accidentally pick another provider's model.

Changing model, effort, or mode applies to your running session when the provider
stays the same. Switching **provider** (or an `/agent` on a different provider)
stages the new configuration while the current session continues. Use `/new` for
a fresh session or `/fork` to carry the current context into the new provider.
While a different provider is staged, configuration commands edit the staged
selection; ordinary messages still reach the current session. `/permission` modes (plan / default / full-access …) control how much the
agent may do without asking; an unattended mode needs approval rights. Fast mode
requires the separate `agent.fast.use` privilege, including when enabled by an
agent profile or already active on a session you want to resume. Returning a
staged provider choice to the running session's provider preserves its active
mode and feature settings unless your selection explicitly changes them.

## Make a choice the default for everyone on this route

The commands above change only this conversation. When the setup you picked
should be what everyone gets, promote it to the **route** that serves this
conversation — the rule that decided which agent answers here. You don't name
the route; the bot uses the one that matched your message.

| You want                                                 | Type                        |
| -------------------------------------------------------- | --------------------------- |
| See which route serves you and its default               | `/routedefault`             |
| Make this conversation's setup the route's default       | `/promoteroutedefault`      |
| Put back the route's default from before its last change | `/promoteroutedefault undo` |

For example, after `/model claude-opus-5`:

```
/promoteroutedefault
Default set for route #3 (mention, contains "deploy"):
claude / claude-opus-5 / high
New conversations on this route use it. Undo: /promoteroutedefault undo
```

Sessions already running keep their setup; the next session on the route uses
the new default. Your own conversation keeps working exactly as before.

Changing a route affects other people, so it needs `channel.manage`: an
organization owner or admin has it, and so does anyone given **Manage** on that
Channel Route in Access. If someone changed the route since your session started,
the bot asks you to check `/routedefault` first.

## One-off questions and forking

Sometimes you want to ask something without disturbing the session running here.

- `/quick <message>` — ask in a fresh, separate session with no context. Your
  bound session is untouched; you just get the answer back here.
- `/side <message>` — same one-off, but the new session starts with this
  conversation's history (a fork), so the answer knows what you've been doing.
- `/fork [message]` — fork this conversation into a new session and **continue
  here** on it. Use it to branch off, or to apply a provider you just staged while
  keeping the context.

Quick way to remember it: **continue here** = `/new`, `/resume`, `/fork`;
**one-off answer** = `/side`, `/quick`. `/side` and `/fork` carry your context;
`/quick` and `/new` start clean.

They also decide where the work lands: `/side` and `/fork` continue what you
were doing, so their session opens in the **same workspace** as the session
here. `/quick` and `/new` start something else, so each opens its own workspace,
named from the message you send.

## Extend the agent

- `/skill`, `/skill search <keyword>`, `/skill <name>` — list, find, or run a
  skill on the agent.
- `/command`, `/command search <keyword>` — list or find dynamic commands.
- `/command add <name> <prompt>` — create a dynamic command from the channel.
- `/command remove <name>` — delete one. (Creating and removing needs the
  privilege `approval.config`.)

A dynamic command is a shortcut you define once and reuse: `/command add standup
summarize what changed today and what's blocked`, then later just `/standup`.

## Who you are here

- `/status` — the bound session, its Paseo link, how much context is left, and
  your access in this conversation.
- `/me` — your public identity and what you're allowed to do here. An identity that is not linked to a Hub Member
  uses the organization's Guest grants; Guest has no permissions by default.

Both reply in the conversation you asked from. On an Automation route, `/status` and
`/cowork` show the runs and step Agents you may access; links use each Agent's Host.

## Approvals

When the agent asks permission, answer inline:

- `/approve` allows the newest request; `/approve <id>` names a specific one.
- `/deny` refuses it.

For a question prompt, include the request id before the answer: `/approve <id>
use the staging database`.

## Retrying after a connection problem

The bot does not execute the same delivered command message twice. If it says an
earlier attempt is still pending or was interrupted, inspect `/status` or the
session in the app before sending a new command message. The first attempt may
already have changed the session even when its acknowledgement did not arrive.

## Channel quirks (when a command doesn't seem to work)

The commands are the same everywhere, but a few channels get in the way. Any of
these fixes works and reaches the same command:

- **Slack** — if `/status` collides with one of Slack's or another app's slash
  commands, use the backslash form instead: `\status`, `\approve`. In a channel,
  address the bot first: `@paseo status`.
- **Telegram** — on mobile, tapping the bot then typing can produce
  `@paseo/status` glued together; that still works. So does `/status@paseo`,
  which the command menu inserts when you pick the bot's line. In a group a plain
  `/status` names no bot and is ignored; in a DM it works.
- **Feishu / Lark** — there are no slash menus; type the command as text and
  @mention the bot in a group so it sees the message. `@everyone` alone does not
  count as addressing the bot.
- **Discord** — the bot registers one `/paseo` command with a text option named
  `command`; supply `status` there. The interaction is acknowledged privately.
- **Google Chat** — an operator registers one `/paseo` command in the app
  console. `/paseo status` is normalized to the shared `status` command.

If a bare word isn't recognized, prefix it with `/` (or `\` on Slack) and send it
on its own line — commands match the whole message, so extra text around them
makes them ordinary prompts to the agent instead.
