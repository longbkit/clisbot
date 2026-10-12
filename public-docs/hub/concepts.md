---
title: How Hub works
description: How a chat message or provider event reaches an agent on a Clisbot daemon, and who may use which daemon.
nav: How it works
order: 62
category: Hub
---

# How Hub works

Hub connects the places where requests arrive to the machines where your agents run, and decides who may use them.

```text
Slack / Telegram / … message      GitHub / Slack / Discord event
            ↓                                   ↓
     Route and its Rules               Automation trigger
            └──────────────┬────────────────────┘
                         Hub
                           ↓
                    Clisbot daemon
                   starts the agent
```

## The pieces

- An **organization** owns everything below: Members, Connections, Routes, Automations, and connected daemons.
- A **daemon** is a connected machine running the Clisbot daemon. A daemon **Project** is a folder on it with its Workspaces. Hub has no Project of its own.
- A **Connection** holds one credential: a Slack workspace installation, a bot token, a QR login.
- A **Route** sends a Connection's messages to a direct agent, a Bot, or an Automation. Its **Rules** say where and from whom a message gets in. Each conversation keeps its own session.
- An **Automation** is a trigger and a workflow. The **trigger** says which provider event can start it; the **workflow** runs ordered **steps**, each one agent execution on an **environment**: a daemon, its working directory, and an optional worktree.
- A **Member** signs in to the Hub. **People & access** grants Members and Teams the daemons and Projects they may use.

You edit all of it in the app's Hub settings (**Channels**, **Automations**, **People & access**, **Hosts**) or through the [Hub API](/docs/hub/api). Exported YAML is an optional portability format.

## From message to reply

1. The Connection receives a message, and Hub stores it before acknowledging the platform.
2. Hub tries each Route in order. The first Route with a Rule that lets the message in wins; a sender no Route admits is refused.
3. Hub creates or resumes that conversation's session on the Route's daemon.
4. The agent's reply goes back to the same conversation.

[Channels](/docs/hub/channels) covers each platform.

## From event to agent

1. A provider sends an event to Hub. GitHub and Slack use webhooks; Discord uses its gateway connection; manual runs use the Hub API.
2. Hub verifies the event and evaluates triggers and their filters, including the required `from_users` allowlist.
3. A matching trigger creates a workflow run from the active revision.
4. Each step whose `if` condition holds starts on its daemon. The next step sees the completed step's output.
5. Hub records replies, structured output, status, and completion.

Complete configurations are in [Workflows](/docs/hub/workflows).

## Saving a change

When you save, Hub validates the change and resolves its references: connections and their filters, the daemon slug or ID, step ids, expressions, output schemas, durations, and named agents. If validation fails, Hub keeps the previous active revision and shows the error.

## Managed access

A daemon in managed access accepts a session only with a Hub access ticket, so a Member reaches exactly what they were granted. Your own daemons on a personal Hub keep managed access off.

## Security boundaries

Routes admit only the senders their Rules allow. Triggers require a non-empty `from_users` allowlist. Anyone who can change Routes or Automations can choose which connections, daemons, and agent capabilities they use, so grant that carefully.

These controls do not sandbox the agent or make input safe. See [Hub security](/docs/hub/security). A step holds GitHub authority only when it declares a [`github` block](/docs/hub/github).
