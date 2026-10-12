# A committed ledger insert can still lose its reply

A channel smoke completed its agent turn, but the answer never reached the channel. The database insert committed before the client deadline expired. The retry found the existing `recorded` row; without caller identity the relay treated it as an uncertain competing post and suppressed delivery.

The relay now allocates one fresh UUID before its bounded database retry loop and supplies it as the new ledger row ID. Only that live caller can recognize its own unposted insert after a lost response. A different call, replay or restarted Hub gets a different UUID and cannot take over. The existing unique delivery key still arbitrates racing inserts; posted rows and uncertain channel sends are never re-posted.

This is an internal Hub persistence correction. It requires no schema migration or daemon/client wire change and stays inside the existing channel-plane boundary. It does not recover a process crash after recording, nor remove the ambiguity of a lost response while re-arming an older failed row.

Verify both sides: inject a failure after commit, assert one real outbound post, race another caller against the lost response, and replay the completed turn. A daemon timeline alone is not proof of channel delivery.

Related: [One lost SSE request blocked a channel](2026-09-22-one-lost-sse-request-blocked-a-channel.md).
