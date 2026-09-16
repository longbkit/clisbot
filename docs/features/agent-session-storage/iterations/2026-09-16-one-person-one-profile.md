# Iteration 2026-09-16 — one person, one profile

Long-term rules this changes live in [design.md](../design.md#identity-rules); this file records
why the decision was taken and what it supersedes.

## Context

A Slack message opened a profile that read `slack:U8ZTVGJJF` and nothing else recognisable. The
same human speaking through Slack, Telegram and the app produced three profile tabs, three
monogram colours, and — on their own messages from a channel — a layout that treated them as
somebody else.

## Problem

`SessionActor.id` was serving as the person key. It is not one. A snapshot records the identity
someone _arrived through_, so one person legitimately owns several ids.

The repo already had the right key: `sessionParticipantKey`, which resolves a snapshot to its
verified Member. It was used for directory filters and nowhere else, while the profile tab, the
monogram colour and adjacent-message author grouping each keyed on `actor.id`.

## Options considered

1. **Rewrite `actor.id` to the Hub `users.id` at capture when the sender is linked**, moving the
   provider identity to a new `channelIdentity` field. Unifies at the source; the app then needs
   no lookup at all.
2. **Keep the snapshot as it is and fix what keys on it.** The recorded shape stays provenance;
   every "same person" question routes through the Member link.

Option 1 costs a protocol field and a change at the capture point, widening the surface that has
to merge with upstream Paseo. It also cannot fix history: sessions already stored keep their old
ids, and this repo does no migrations. Its one apparent advantage — a self-sufficient snapshot —
turned out to be smaller than it looked, because a snapshot only ever knows the single channel
that interaction came through. Listing _every_ channel a person has linked is a live Hub read
under either option.

## Decision

Option 2.

- **Supersedes nothing in the identity rules table** — "Channel, Member linked → keep the channel
  id and scope; add the verified `memberId`" stands, and is now actually relied on.
- The profile tab, the monogram colour and author grouping key on `sessionParticipantKey`.
- The profile panel reads live: the person from the organization roster that already ships with
  the account state, their linked Channel identities from the Hub, and the snapshot kept visible
  as provenance.
- `isOwnActor` matches on the Member link when both sides carry one.

## Consequences

**Sessions recorded before this change unify too**, because `memberId` was already being written.
That is the property option 1 could not have.

**`hubOrigin` became load-bearing.** `sessionParticipantKey` needs the full scope, and the app
admission path (`accountActor`) was never setting it — so an app snapshot could not group with
the same person's channel snapshots. The failure mode was silence, not an error. All three
producers now normalize through `normalizeHubOrigin`, which is deliberately narrower than the
daemon's `normalizeHubUrl`: an actor scope is the origin, a relationship record is a URL that may
carry a subpath.

**Avatars became free.** The roster arrives with the account state, so a current profile image
costs no request and applies to snapshots stored long before it was set. The channel capture path
also records the Member's image, which covers the reader who cannot see the roster.

**The linked-identity list is scoped by Hub, not by the app.** A Member sees their own links; an
administrator sees the organization's. An empty list means "not visible to you".

## Still open

A timeline item stores its `sender` but not the channel reference, though
`captureSessionIdentity` holds both. A session that takes messages from two conversations cannot
attribute a message to one of them. Session-level `channels[]` still answers "which conversations
fed this session".
