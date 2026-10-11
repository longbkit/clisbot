---
title: Hub
description: The layer above your daemons. Chat with agents from Slack and Telegram, share daemons with your team, and run automations.
nav: Overview
order: 60
category: Hub
---

# Hub

A daemon runs agents on one machine, for you. Clisbot Hub is the layer above your daemons. Connect your daemons to it, and it gives them what they cannot do on their own:

- **Channels.** Talk to your agents in [Slack, Telegram, and other chat platforms](/docs/hub/channels), answering in the same conversation.
- **Managed access.** Share daemons and their projects with your team. Each member gets only what you grant.
- **Automations.** Start agents from activity in GitHub, Slack, and Discord.
- **Activity.** A record of everything that arrived, what it matched, and what ran.

Your daemons keep running agents where they always did. Hub decides who may use them and when to ask them.

## Personal Hub or team Hub

|          | Personal Hub                                                                   | Team Hub                                                                         |
| -------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Runs on  | One of your own machines                                                       | A server your team operates                                                      |
| Sign-in  | None. Your devices pair with a QR code                                         | Members sign in with an account                                                  |
| To start | **Settings → Hubs → Add Hub → Start a Hub**, or `clisbot hub start --personal` | [Self-hosting](/docs/hub/self-hosting); machines join with `clisbot hub connect` |

Clisbot does not run a hosted Hub. Every Hub is one you or your team operates.

## Several Hubs at once

The Clisbot app keeps every Hub you add beside the daemons you connect directly. A common setup is a personal Hub for your own channels and your company's Hub for work:

```text
   Personal Hub          Company Hub
     ┌───┴───┐           ┌────┴─────┐
  laptop   devbox    work laptop  build server
```

Daemons from both Hubs appear together in the app. **Settings → Hubs** chooses which Hub's settings you see. Each daemon belongs to one Hub.

## Reading order

1. [Quickstart](/docs/hub/quickstart)
2. [How it works](/docs/hub/concepts)
3. [Daemons](/docs/hub/daemons)
4. [Channels](/docs/hub/channels)
5. [Triggers](/docs/hub/triggers)
6. [Workflows](/docs/hub/workflows)
7. [GitHub access](/docs/hub/github)
8. [Configuration](/docs/hub/configuration)
9. [Security](/docs/hub/security)

If a Route or workflow accepts requests from GitHub, Slack, Discord, or the API, read [Hub security](/docs/hub/security) before giving an agent access to a working directory or output capability.
