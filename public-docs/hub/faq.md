---
title: Hub FAQ
description: Common questions about personal and team Hubs, channels, access, and daemons in Clisbot Hub.
nav: FAQ
order: 78
category: Hub
---

# Hub FAQ

## Do I need Hub to use Clisbot?

No. Clisbot runs agents on your machines without it. Hub adds what a single daemon cannot do on its own: chatting with agents from chat platforms, sharing daemons with a team, starting agents from external activity, and a shared record of what ran.

## Personal Hub or team Hub?

A personal Hub runs on one of your machines for your own channels and needs no account sign-in. A team Hub runs on a server your team operates, and members sign in. See [Hub](/docs/hub#personal-hub-or-team-hub).

## Can I use a personal Hub and my company's Hub together?

Yes. The app keeps every Hub you add, plus the daemons you connect directly, and shows their daemons together. **Settings → Hubs** chooses which Hub's settings you see. Each daemon belongs to one Hub.

## Who can talk to my agent from Slack or Telegram?

Only senders a Route's Rules let in. Before any Route exists, the bot answers `/status` and `/me` with the sender's ID, so you can name people in a Rule. See [Channels](/docs/hub/channels).

## Can teammates use my daemon?

Yes, on a team Hub. Grant a Member or Team the daemon or its Projects in **People & access**. A daemon in managed access accepts their sessions only with a Hub access ticket.

## Can one organization connect several Slack workspaces or GitHub organizations?

Yes. Connections belong to the organization and there is no limit on how many you add.

## Where does configuration live?

In Hub. Edit Routes in **Channels** and Automations in **Automations** in the app's Hub settings, or use the [Hub API](/docs/hub/api). YAML export is optional.

## Who can trigger an Automation?

Only the users listed in its trigger's `from_users`. It is required and cannot be empty.

## What happens if the daemon is offline?

An Automation's dispatch fails and the event is recorded as failed. Nothing is queued, so trigger it again once the daemon is back.

## Does logging out disconnect my daemon?

No. The stored CLI login is a human organization credential; the enrolled daemon has its own relationship credential. Interactive `clisbot hub logout` offers to disconnect a daemon related to the same Hub. Declining is normal, and JSON or noninteractive logout never disconnects unless you pass `--disconnect-daemon`.

## Can an Automation reply in Slack or Discord?

Yes. Put `allow_outputs` on the step and tell the agent to call `hub.reply` in the prompt. See [Tell the agent which tool to call](/docs/hub/workflows#tell-the-agent-which-tool-to-call). A Route's agent replies in the same conversation without this.

GitHub has no reply capability; give the step a [`github` block](/docs/hub/github) and the agent acts through the `gh` CLI.

## Can I use it without GitHub?

Yes. Channels and access need no GitHub. GitHub is only needed for GitHub triggers and GitHub access in workflow steps.
