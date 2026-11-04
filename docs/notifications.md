# Notifications

Use `notification-open` for OS notification taps. It owns delivery, parsing,
process-local deduplication, startup readiness, and native acknowledgement.
Keep agent and workspace navigation in their existing navigation modules.
Import the pure API from `@/notification-open` and the app-shell component from
`@/notification-open/react`; senders must not load the React routing runtime.

Agent payloads name a host and agent. Ignore their workspace hint when opening:
the agent can move after a notification is sent. Use `navigateToAgent`, which
uses the current store record or the agent route to resolve the workspace from
the host. Terminal payloads name their workspace and use `navigateToWorkspace`.

See [agent targets and deferred opens](expo-router.md#agent-targets) for route
ownership and workspace recovery. Notification generation, presence, and push
eligibility remain daemon concerns.

## Audience

A session notifies the people it belongs to, by the same For me / Others rule as the session list
([navigation-v2](features/navigation-v2/README.md)). Each reader picks a scope in Settings →
Notifications: For me (default), Needs me, Others, All or Off. Needs me narrows For me to what
Home's Needs me chip shows unseen: a request waiting for an answer, or a failure
(`issues.ts` `currentIssueKind`); a failure, in-app only under For me, reaches a Needs me reader's
phone. A Host without `features.notificationNeedsScope` is sent For me. The app sends it to every Host with
`notifications.set_scope.request` (gated by `features.notificationScope`) and resends it on each
connect; the daemon stores it with that device's push token.

The daemon judges every reader separately, for both pushes and in-app notifications:

- The reader is the connection's Hub account, with or without a managed lease. A lease without one
  is not notified. A connection with neither is the Host owner's own device, which owns everything
  on its Host.
- A session is For me when the reader follows it, or its verified creator, its schedule's
  verified owner, or a verified sender is the reader. Follows live on each Host per reader
  (`notifications.set_follow` / `list_follows`, `features.notificationFollows`): a reader can follow
  only a session it may read, the list hides follows whose access was lost, and a follow never
  widens access. The app stamps follows onto its agents, so every list agrees. A channel sender matches only through its linked Member. A session that
  names no verified person, such as a subagent, is its nearest parent's.
- Work nobody can attribute notifies For me only for the Host owner and daemon-wide readers. The
  session list still shows it under For me; a Project Member is not paged for it.
- Presence is per reader. One person's open app takes their own notification instead of a push
  to their phone, and never suppresses or receives a teammate's.
- The daemon cannot tell the Host owner's direct devices from the same person's Hub account, so
  they are separate readers: the owner can be notified on both, never on neither.
- A connection only learns about sessions and terminals it may read when the event is sent: the
  same Project and Terminal rules as its other outbound messages, checked again in
  `Session.publishToSource`, and nothing after its lease expires or its Project is revoked.
- Opening a notification fetches the session over the reader's own connection, which the Host
  authorizes again; the payload's ids grant nothing.
- A Hub revocation removes the push tokens of every revoked lease, including devices that are
  offline. While the daemon's Hub link is not connected a revocation cannot reach it, so
  lease-bound tokens get one generic payload that identifies nothing: no title or preview from the
  session and no Host, Project, workspace, path, agent or terminal id. Tapping it opens the app
  without navigating, and the app reads only what the Host authorizes after it connects. The
  Host owner's own devices keep full notifications. Tradeoff: during a Hub outage Members lose
  the deep link and the preview. The remaining window is a Hub link that reads as connected while
  a revocation is still in flight.

Pushes are plain alerts with no Notification Service Extension, so iOS shows them before app code
runs: filtering has to happen on the daemon. A Host without `features.notificationScope` keeps the
old behaviour of notifying every token its Project lease allows. The Hub-owned feed and push in
[ADR-001](decisions/ADR-001-hub-control-plane-activity-feed-push.md) remain proposed.
Implementation: `packages/protocol/src/notification-audience.ts` (rule) and
`packages/server/src/server/push/attention-audience.ts` (per-reader plan).

## Native delivery

Keep the router instance at module scope. Android's `singleTask` Activity can
finish on Back while its JS context remains alive. A React ref is lost when the
root remounts; process-local handled IDs must survive that remount.

Clear `lastNotificationResponse` after dispatch. Reading a launch response does
not acknowledge it. Without clearing it, a later Activity launch can reopen the
old agent.

With expo-notifications 57, Android also replays its pending response list to
new native listeners. Clearing the last response does not drain that list.
Deduplication covers listener registration within one JS context. A development
JS reload creates another context and can replay a cold-launch response; do not
add persisted handled IDs to compensate. Recheck this limitation when upgrading
expo-notifications.

iOS drains pending responses when its delegate first handles them. Push data
read by Expo arrives under `userInfo.body`; simulator payloads must match:

```json
{
  "aps": { "alert": { "title": "Agent finished", "body": "Open the agent" }, "sound": "default" },
  "body": {
    "serverId": "host",
    "workspaceId": "workspace",
    "agentId": "agent",
    "reason": "finished"
  }
}
```

An Android FCM launch intent needs `google.message_id` and a JSON `body` extra.
An arbitrary Activity launch with data extras does not exercise Expo's FCM path.

Foreground pushes remain in Notification Center without a banner or sound.
This preserves notifications sent with stale presence information.

## Startup and verification

Wait for the root navigator, host registry, remembered selection, and startup
redirects before handing off a tap. A compact agent route must demand the host's
directory itself; its sidebar can be closed for the entire cold launch.

Verify warm and cold taps, stale and missing workspace hints, two distinct taps,
and Android Back followed by launcher reopen or a different notification tap. Check the focused tab and every
workspace's saved layout, since a foreign pinned tab survives navigation.
Use the daemon's payload shape on both iOS and Android; a browser event alone
does not test native replay or acknowledgement.

Existing foreign pins belong to the reconciliation fix in
[#6900](https://github.com/longbkit/clisbot/issues/6900). Desktop main-process window
selection is tracked separately in
[#6875](https://github.com/longbkit/clisbot/issues/6875).
