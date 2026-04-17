# Recent Conversation Replay

## Summary

Slack and Telegram now share the same recent-context replay rule for routed conversations.

When the bot finally gets invoked after earlier messages were ignored because of mention policy or follow-up timing, it can replay a small bounded tail of recent messages into the next prompt.

## Contract

Per routed conversation boundary, `clisbot` persists only:

- `lastProcessedMarker`
- the latest 5 `recentMessages`

The boundary is the existing routed session key:

- Slack channel thread: `channelId + threadTs`
- Slack non-thread channel route: `channelId`
- Telegram DM: `chatId`
- Telegram group: `chatId`
- Telegram topic: `chatId + topicId`

The marker is platform-native:

- Slack: `ts`
- Telegram: `message_id`

## Write Rule

For each inbound routed message inside that boundary:

- append it to `recentMessages`
- cap the list to the latest 5 entries
- keep marker-only entries when the message should not be replayed as text, so processed boundaries still stay truthful

`lastProcessedMarker` updates only when the message is actually accepted into agent execution:

- normal prompt enqueue
- queued prompt enqueue
- steer submission into an active run

It does not advance on:

- mere delivery or visibility
- `/status`, `/help`, `/stop`, `/attach`, `/detach`, or other control commands
- pairing or unrouted surfaces

## Replay Rule

Before building the next agent prompt:

1. walk `recentMessages` from newest backward
2. stop when a marker matches `lastProcessedMarker`
3. everything after that marker is the unprocessed tail
4. drop the current message itself from the replay tail
5. prepend the remaining replayable text to the current prompt

If the processed marker has already fallen out of the 5-message window, `clisbot` replays the full surviving window. That is the intended bounded-loss tradeoff.

## Scope Notes

- This replay is conversation-local, not global.
- It is meant to recover small recent gaps, not rebuild a long thread.
- The replay block is prompt-only. It does not change user-visible channel text.
- Mention-only messages can still move the processed marker even when they contribute no replayable text themselves.
