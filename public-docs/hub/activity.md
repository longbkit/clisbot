---
title: Hub activity
description: Read what Hub did with an event, tell a filtered event from an unrouted one, and debug a trigger that did nothing.
nav: Activity
order: 72
category: Hub
---

# Hub activity

Use the view for the path you configured: a Channel Route or an Automation event.

## Where to look

In the app, **Channels → Activity** lists messages evaluated against Routes. Filter by Connection, Route and outcome; open an event for its reason and recovery actions. A test reply checks outbound delivery only and does not appear as an inbound Route run.

**Automations → your Automation → Runs** shows Workflow results. The Hub dashboard's **Activity** lists organization trigger runs; **Connections → Known unrouted events** records accepted provider events that matched no Workflow:

| Reason                      | Meaning                                                       |
| --------------------------- | ------------------------------------------------------------- |
| `no_workflow_route`         | No Workflow route is configured for this event.               |
| `no_trigger_for_source`     | No configured trigger handles the source.                     |
| `trigger_filters_rejected`  | The source matched, but filters rejected the event.           |
| `configuration_unavailable` | A relevant configuration or Connection could not be resolved. |

## Nothing happened when I mentioned the bot

1. **Which path is configured?** For a Route, check its Rules: Where, Who and message conditions. For a direct event, check `from_users`, resource and content filters. GitHub uses logins; prefer stable Slack/Discord user IDs. See [Channels](/docs/hub/channels) or [Triggers](/docs/hub/triggers).
2. **Did Hub receive it?** Look in Channel activity, Automation Runs or Known unrouted events. If absent, check Connection status and the provider delivery log. GitHub exposes App → Advanced → Recent Deliveries; Slack's direct-event path uses Event Subscriptions.
3. **Is the intended revision active?** A failed save or sync leaves the old revision serving. Check configuration and errors before recreating anything.
4. **Is the Host connected?** Confirm the target and its Hub relationship has `hub.execute`. A provider event dispatch can fail with `daemon_not_connected`.
5. **Did it stop early?** Compare the run with its step's `idle_timeout`, `max_runtime`, and Workflow deadline. Inspect author-access rejection separately from provider startup failure.
6. **Did it run without replying?** Check both the input's reply settings and the responding step's output grant. The prompt must name `hub.reply` and `hub.finish_execution`. See [Workflow instructions](/docs/hub/workflows#tell-the-agent-which-tool-to-call).

## Sync failures

Repository-backed Configuration shows the last sync attempt. **Fetch failed** means the file is absent at that commit or the App cannot read it. **Invalid** means YAML or resource resolution failed. **Superseded push ignored** means a newer commit already moved the branch head.

Check renamed Hosts, unavailable Connection slugs and repository installation coverage. See [Repository bundles](/docs/hub/configuration#repository-bundles).

## Recovery and retries

Channels have a durable **Ingress queue**. Retryable failures and busy Routes can wait for another attempt; retries are bounded. Inspect waiting work and **Dead letters** before sending a duplicate request. An Organization Admin or the Connection's Admin can resubmit its dead letters after fixing the cause.

This queue does not promise replay for every external Automation event. A failed direct-event run may need a fresh invocation after the Host returns. Check its final state and any earlier side effects first.
