# Slash commands — user guide

Type these in any channel where the bot is present — Slack, Telegram, Discord,
Feishu, Google Chat. They control the agent session bound to the conversation
you type them in. The full list and what each needs is the
[command reference](README.md#command-reference); this guide is how to use them.

## The short version

- `/help` shows every command in the conversation you're in.
- Most commands act on **this conversation's** agent. `/new` starts one, `/stop`
  stops it, `/cowork` opens it in the Paseo app.
- If a command needs a permission you don't have, the bot says so and does
  nothing — nothing changes silently.

## Move between the channel and the app

`/cowork` replies with a link that opens this conversation's agent session in the
Paseo app, or the web app configured by your Hub operator. Use it to pick up the same session on your
phone or desktop and keep working, then come back to the channel — the session
is the same on both sides.

In a **public** channel the link is sent to you privately (a DM), because it opens your dev environment and not everyone in the channel
should reach it. You need `agent.interact` access in this conversation to get a link. Private delivery failures never publish the link back to the public conversation.

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

Both reply privately in a public channel. On an Automation route, `/status` and
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
  commands, use the backslash form instead: `\status`, `\approve`. You can also
  address the bot first: `@paseo status`.
- **Telegram** — on mobile, tapping the bot then typing can produce
  `@paseo/status` glued together; that still works. So does `/status@paseo` from
  autocomplete, and a plain `/status` in a group where the bot is a member.
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
