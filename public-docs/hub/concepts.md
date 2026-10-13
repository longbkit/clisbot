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
- A **Host** is your app's connection to a machine; its **daemon** runs agents. A **Project** is a selected root on that Host, containing Workspaces. Hub has no Project of its own.
- A **Bot** is a durable persona with a home Project/Workspace. A **Chat** is your conversation with same-Host Bots. See [Bots and Group chats](/docs/bots-and-chats).
- A **Connection** holds one credential: a Slack workspace installation, a bot token, a QR login.
- A **Route** sends a Connection's messages to a direct agent, a Bot, or an Automation. Its **Rules** say where and from whom a message gets in. Each conversation keeps its own session.
- An **Automation** is a trigger and a workflow. The **trigger** says which provider event can start it; the **workflow** runs ordered **steps**, each one agent execution on an **environment**: a daemon, its working directory, and an optional worktree.
- A **Member** signs in to Hub. **People & access** grants Members and Teams Host/Project access.

You edit all of it in the app's Hub settings (**Channels**, **Automations**, **People & access**, **Hosts**) or through the [Hub API](/docs/hub/api). Exported YAML is an optional portability format.

## From message to reply

1. The Connection receives a message, and Hub stores it before acknowledging the platform.
2. Hub tries each Route in order. The first Route with a Rule that lets the message in wins; a sender no Route admits is refused.
3. Hub creates or resumes that conversation's session on the Route's daemon.
4. The agent's reply goes back to the same conversation.

[Channels](/docs/hub/channels) covers each platform.

## From event to agent

1. A provider sends an event to Hub. GitHub and Slack use webhooks; Discord uses its gateway connection; manual runs use the Hub API.
2. Hub verifies the event and evaluates triggers and their filters, including sender allowlists where required.
3. A matching trigger creates a workflow run from the active revision.
4. Each step whose `if` condition holds starts on its daemon. The next step sees the completed step's output.
5. Hub records replies, structured output, status, and completion.

Configure this in [Workflows](/docs/hub/workflows).

## Saving a change

Current app/API Automation saves validate fields and compile the definition; they do not test the target daemon's live provider/model availability. An offline target can be saved and fail at dispatch. The legacy configuration-bundle installer separately validates named agents against the daemon. See [Automations](/docs/hub/automations) and [Configuration](/docs/hub/configuration).

## Managed access

After Hub enrollment, an `external` Managed access daemon requires Hub tickets for app connections and checks Host/Project grants. In `off` mode, ordinary paired sessions have owner rights. See [Managed access](/docs/hub/managed-access) for Team sharing, Agent limits and exceptions.

## Security boundaries

Routes admit only the senders their Rules allow. Event inputs use [trigger filters](/docs/hub/triggers#filters). Anyone who can change Routes or Automations can choose which connections, daemons, and agent capabilities they use, so grant that carefully.

These controls do not sandbox the agent or make input safe. See [Hub security](/docs/hub/security). A step holds GitHub authority only when it declares a [`github` block](/docs/hub/github).
