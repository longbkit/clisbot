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
Paseo app (or paseo.sh in a browser). Use it to pick up the same session on your
phone or desktop and keep working, then come back to the channel — the session
is the same on both sides.

In a **public** channel the link is sent to you privately (an ephemeral message
or a DM), because it opens your dev environment and not everyone in the channel
should reach it. You need to be a participant in the conversation to get a link.

## Start, resume, and stop a session

| You want                                                  | Type                            |
| --------------------------------------------------------- | ------------------------------- |
| A fresh session, bound here                               | `/new`                          |
| A fresh session with a first message                      | `/new fix the flaky login test` |
| To continue an existing session here                      | `/resume <id>`                  |
| To stop the current turn (or cancel a running automation) | `/stop`                         |

`<id>` is the agent id shown by `/status` or in the app's URL. `/resume` replaces
whatever session was bound here before.

## Guide a running turn

- `/steer <message>` slips a message into the turn the agent is already running —
  a nudge without interrupting.
- `/queue <message>` holds your message until the current turn finishes, then
  sends it.

These apply to a directly-bound agent. In a conversation that runs an
**automation**, use `/stop` to cancel the run and just send a normal message to
start a new one.

## Switch agent, provider, model, effort, and mode

The bot only offers the choices you're allowed — not the whole catalog. Any
participant can switch; only creating a dynamic command or running an unattended
mode needs admin.

| You want                    | Type                                                       |
| --------------------------- | ---------------------------------------------------------- |
| Apply an agent profile      | `/agent`, `/agent <name>`                                  |
| See / switch provider       | `/provider`, `/provider search openai`, `/provider openai` |
| See / switch model          | `/model`, `/model search sonnet`, `/model <name>`          |
| See / set effort            | `/effort`, `/effort high`                                  |
| See / set mode (permission) | `/permission`, `/permission plan`                          |

An **agent profile** is a saved bundle (provider + model + mode + thinking);
`/agent <name>` applies one in a single step, and `/agent` lists the profiles you
may use. `/provider`, `/model`, and `/effort` tune one axis at a time, and
`/permission` sets the mode. A bare command shows the menu.

These three nest — a provider has its own models, and each model its own effort
levels — so the bot keeps them unambiguous: `/model` lists only the current
provider's models, `/effort` only the current model's levels, look-alike names show
as `provider/model`, and every change confirms the full setup ("Provider: openai ·
Model: … · Effort: …"). You can't accidentally pick another provider's model.

Changing model, effort, or mode applies to your running session when the provider
stays the same. Switching **provider** (or an `/agent` on a different provider)
starts a fresh session — the bot tells you, and `/fork` carries your context
across. `/permission` modes (plan / default / full-access …) control how much the
agent may do without asking; an unattended mode needs approval rights.

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
- `/command remove <name>` — delete one. (Creating and removing needs admin
  rights in the conversation.)

A dynamic command is a shortcut you define once and reuse: `/command add standup
summarize what changed today and what's blocked`, then later just `/standup`.

## Who you are here

- `/status` — the bound session, its Paseo link, how much context is left, and
  your access in this conversation.
- `/me` — your public identity and what you're allowed to do here.

Both reply privately in a public channel.

## Approvals

When the agent asks permission, answer inline:

- `/approve` allows the newest request; `/approve <id>` names a specific one.
- `/deny` refuses it.

For a question prompt, put your answer after the verb: `/approve use the staging
database`.

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
- **Discord / Google Chat** — the bot registers a single `/paseo` command;
  `/paseo status` runs the same commands as everywhere else.

If a bare word isn't recognized, prefix it with `/` (or `\` on Slack) and send it
on its own line — commands match the whole message, so extra text around them
makes them ordinary prompts to the agent instead.
