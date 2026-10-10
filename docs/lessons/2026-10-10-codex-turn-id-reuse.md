# Restoring a Codex session must not reuse a turn id

On 2026-10-10, Product's Codex agent finished a Slack reply, but the Hub did not post it. The restored agent reused `codex-turn-0`; its durable delivery ledger already recorded that agent/turn key from the previous day. The relay also treats a closed turn as complete, so the new answer could be discarded before a new delivery record was written.

Generate a UUID for each foreground turn instead of a process-local ordinal. All events emitted for a turn keep that id, preserving replay deduplication while separating genuinely new turns across provider-session reconstruction and daemon restarts. No ledger deletion or thread reset is needed.

The regression test creates a session, starts a turn, closes and restores the same persisted provider thread, then checks that the next turn has a different id and its completion carries that new id.

This is a narrow backport onto the deployed Fusion baseline `d5dcd531146b02bca82ef756071f5fa9cf4c6bee`. The fix and regression also exist on the main development checkout as `f515ddf78`. Apply the new runtime to Product only after its active foreground work finishes or the operator explicitly approves interrupting it.
