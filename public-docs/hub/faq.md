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

Only senders a Route's Rules let in. With public commands enabled, `/me` gives your sender ID and `/status` gives conversation/thread IDs even before a Route exists. Use them to configure a Rule. Group `/me` can request a DM. See [Channel commands](/docs/hub/channels/commands).

## Can teammates use my daemon?

Yes. Grant Members or Teams Host/Project access in **People & access**, and require Managed access on that Host. Ordinary paired sessions in `off` mode have owner rights. See [Managed access](/docs/hub/managed-access).

## Can one organization connect several Slack workspaces or GitHub organizations?

Yes. Connections belong to the organization. Add separate installations for the Slack workspaces or GitHub accounts you need.

## Where does configuration live?

In Hub. Edit Routes in **Channels** and Automations in **Automations** in the app's Hub settings, or use the [Hub API](/docs/hub/api). YAML export is optional.

## Who can trigger an Automation?

Channel inputs use Route Rules. Direct events use sender filters, with exceptions for manual and project-scout inputs. See [trigger filters](/docs/hub/triggers#filters) and review the input before enabling it.

## What happens if the daemon is offline?

An Automation's dispatch fails and its run records the error; trigger it again once the daemon is back. Channel messages have separate [durable ingress handling](/docs/hub/activity); this is not an Automation retry queue.

## Does logging out disconnect my daemon?

No. The stored CLI login is a human organization credential; the enrolled daemon has its own relationship credential. Interactive `clisbot hub logout` offers to disconnect a daemon related to the same Hub. Declining is normal, and JSON or noninteractive logout never disconnects unless you pass `--disconnect-daemon`.

## Can an Automation reply in Slack, Discord or GitHub?

Yes. Native replies use `hub.reply`; GitHub replies comment on the triggering issue/PR. Trigger documents can add optional reply grants by default; review `allow_outputs` and tell the agent to call the tool. A step's [`github` block](/docs/hub/github) separately grants `git`/`gh` authority. See [Workflows](/docs/hub/workflows).

## Can I use it without GitHub?

Yes. Channels and access need no GitHub. GitHub is only needed for GitHub triggers and GitHub access in workflow steps.
