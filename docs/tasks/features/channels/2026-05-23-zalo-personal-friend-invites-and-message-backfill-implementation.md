# Zalo Personal Friend Invites And Message Backfill Implementation Notes

## Scope

This note records live implementation details for
[Zalo Personal Contacts, Groups, And Full Tool Surface](2026-05-18-zalo-personal-contacts-groups-and-full-tool-surface.md).
Keep operator-facing guidance in
[Zalo Personal](../../../user-guide/zalo-personal.md).

## Findings

- zca-js `getSentFriendRequest` calls `/api/friend/requested/list`.
- zca-js documents Zalo code `112` as a possible empty sent-request list.
- clisbot normalizes code `112` to `sent: {}` so
  `contacts friend-invites list --direction sent|all` stays readable.
- Incoming friend requests come from `getFriendRecommendations()` entries where
  `dataInfo.recommType` is `2`.
- `listener.requestOldMessages(ThreadType.User)` can return global user-message
  backfill via `old_messages`, but it is not a target-specific history API.
- Live validation on 2026-05-23 saw an outgoing non-friend DM from Clisbot to
  Zalo Long in `old_messages` with content `Hi`.
- The earlier missing message was explained by timing: it was sent from the
  mobile app outside clisbot before the Zalo Personal session was logged in and
  listening.
- Incoming stranger DM was still not visible in listener logs, contact search,
  incoming friend invites, or shared `message read`.

## Test Coverage

- Unit: `test/zalo-personal/operator-cli.test.ts`
  - `friend invite list treats Zalo code 112 as an empty sent list`
- Live checks used:
  - `clisbot-dev contacts friend-invites list --channel zalo-personal --bot default --direction sent --json`
  - `clisbot-dev contacts friend-invites list --channel zalo-personal --bot default --direction all --json`
  - a short zca-js listener script calling
    `listener.requestOldMessages(ThreadType.User)` and inspecting
    `old_messages`

## Current Constraint

Do not expose `message read --target dm:<id>` for Zalo Personal from
`requestOldMessages` yet. A production-ready implementation needs filtering by
target, pagination/last-message handling, stale-window behavior, and tests that
separate messages sent before login from messages visible after login.
