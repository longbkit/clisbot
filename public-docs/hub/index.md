---
title: Hub
description: Connect eight messaging integrations, share Hosts and Projects with your team, and run automations on your machines.
nav: Overview
order: 60
category: Hub
---

# Hub

A daemon runs agents on one machine, for you. Clisbot Hub is the layer above your daemons. Connect your daemons to it, and it gives them what they cannot do on their own:

- **Channels.** Connect [eight integrations](/docs/hub/channels): Slack, Telegram, Discord, Google Chat, Feishu/Lark, Zalo Official Bot, Zalo Personal and WhatsApp. Setup and capabilities vary by channel.
- **Managed access.** Grant [Members and Teams access](/docs/hub/managed-access) to Hosts or Projects, with allowed Agent configurations.
- **Automations.** Start agents from activity in GitHub, Slack, and Discord.
- **Activity.** A record of everything that arrived, what it matched, and what ran.

Use your personal channels to continue work away from your desk, or share selected Projects with a team. Your daemons run the agents; Hub routes requests and access. [Bots and Group chats](/docs/bots-and-chats) also work without Hub.

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

## Start here

[Quickstart](/docs/hub/quickstart) → [How it works](/docs/hub/concepts) → [Enroll a daemon](/docs/hub/daemons).

Then choose [Channels and commands](/docs/hub/channels), [Managed access](/docs/hub/managed-access), or [Automations](/docs/hub/automations). Read [Hub security](/docs/hub/security) before giving external requests agent authority.
