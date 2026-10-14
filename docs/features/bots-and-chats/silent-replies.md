# Silent Bot replies

Long's 2026-10-14 requirement supersedes the earlier direct-chat exemption for `PASS` in
[group discussion](plans/group-discussion.md#silence-is-a-valid-turn). Both exact trimmed markers,
`PASS` and `HEARTBEAT_OK`, mean silence in Bot direct and group Chats. Group discussion scheduling,
round termination and mention routing retain their existing behavior.

## Matching and ownership

`packages/protocol/src/chats/room.ts` owns the marker list and exact/prefix predicates.
The predicates match a complete Bot reply, never a substring. A user writing either marker keeps
their message. Longer answers, case variants, mentions, quoted text, inline code and fenced code
are meaningful text. Ordinary cowork agent sessions retain exact marker replies too.

The Chat turn tracker assembles source deltas with the same `messageId` without separators;
distinct assistant messages in the last contiguous run join with a blank line. A tool event
ends the prior run. `final-answer.ts` and the app share the removal of Codex's exact
`\n\n---\n\n` assistant-message boundary before interpreting timeline reply text. This framing
normalization does not rewrite stored history or strip arbitrary Markdown from a displayed reply.
The app checks the whole contiguous assistant run and respects its turn identity. It never joins
unrelated turns to recognize a marker, or removes a marker message from a longer contiguous answer.

The daemon records the completion receipt before suppression. Direct Chat suppression uses
`isSilentBotReply`; group suppression also accepts no text through `isSilentReply`. A direct turn
with no answer retains its existing "finished without a reply" notice. Failures remain system
notices and do not become silent success.

## Why direct Messages could show HEARTBEAT_OK

At baseline `2aeb8b5`, a real isolated app/daemon fixture reproduced this on
`/h/:serverId/chat/:chatId` → Messages: the direct Chat showed a horizontal rule and `HEARTBEAT_OK`
after completion, while its daemon transcript contained only the user's prompt. The same event
shape in a group showed no marker.

The daemon's final-answer path already removed the provider boundary and suppressed the marker.
The app's direct tail checked the raw assistant item, so trimming yielded `---\n\nHEARTBEAT_OK`,
which failed `isHeartbeatAck`. The group path discarded all ended-turn tail items, avoiding that
bypass. The defect was in the direct timeline presentation, independent of the deliberate old
`PASS` exception. A reload in the first fixture hid the heartbeat marker; that did not disprove
the visible completion defect. The regression therefore checks completion before reloading and
waits for authoritative history when testing reload.

## Streaming and completion

`useChatLiveHeads` selects both committed tail and active head arrays. Keeping their references
separate preserves the selector's no-op behavior for unrelated agents. `chatLiveItems` uses the
session timeline's existing head/tail handoff; it does not alter the canonical session stream.
Both expanded/collapsed body displays and header activity see the same items.

While a reply spells a marker prefix, Messages withholds its text and keeps the running footer
and permissions. A longer prefix-sharing answer appears as soon as it diverges, including the
withheld prefix. An incomplete marker at a completed/canceled turn is ordinary text. A complete
silent direct turn removes its successful tool/thought leftovers, while notifications, failed
or canceled tools and pending permissions remain. Earlier identified turns remain intact even when their
prompt has left the bounded tail. The header retains its existing latest-tool inspection behavior.

Older transcript marker records are filtered on read in the Bot render model. Their bytes, IDs,
sequence positions, user messages and completion receipts remain intact through reload/reconnect.
The change stays inside the existing `bots` capability; it adds no wire fields, migration,
release/version change or ordinary agent-session filtering.

## Focused verification

Run the affected files from their package directories, never the full suites:

- App: `render-model.test.ts`, `chat-screen.test.tsx`, `tool-activity.test.ts`, and
  `use-chat-live-heads.test.tsx` under `src/clisbot/bots/chat/`.
- Daemon: `chat-engine.test.ts`, `room-contract.test.ts`, `turn-tracker.test.ts`, and
  `reconcile.test.ts` under `src/server/chats/`.
- Real app and isolated daemon: `npm run test:e2e --workspace=@clisbot/app --
e2e/browser/bot-dm-silent-replies.spec.ts` from the repository root.

The browser spec uses the deterministic provider through the real daemon and WebSocket path.
It compares group and direct completion, captures provider-boundary frames and screenshots,
reads old transcript records, drops/restores only its own socket, checks live prefix recovery,
and preserves ordinary agent-session markers. Its compact viewport is phone-web evidence;
native iOS/Android gestures and keyboard behavior require separate native verification.
