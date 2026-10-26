# ADR-001 — Hub as control plane: activity feed, push and personal Hub

- Status: **Proposed** (2026-10-26). Documentation only; no implementation authorized. Owner first accepts the current integration build (`integration/nav-v2-offline-o1` 83eb7e5f8).
- Deciders: product owner, engineering lead (Atlas, CTO agent)
- Context docs: `docs/decisions/*offline*` and `2026-10-26-background-freshness.md` (pain points, offline proposal, storage volume, background freshness §6–§9)
- Baseline: clisbot `main` da002ef07

## 1. Context

- Users connect to personal machines, personal sandboxes and company Hubs fronting tens to hundreds of sandbox Hosts. Connections are unstable (VPN, sleep, restarts).
- Today each daemon pushes alert-only notifications directly via Expo Push. Opening one requires connecting to that sandbox before any content appears. No content is fetched in the background.
- Offline O1 (client resilience) is built. O2 (local store) is not yet built.
- Owner requirements: a messaging-app feel ("open → latest content is already there"), performance that holds at 100+ sandboxes, enterprise-grade security, and one simple model.

## 2. Decision

### D1. Always through a Hub

Every source reaches clients through a Hub. A personal user runs a **personal Hub** (`clisbot hub start --personal`, already exists). Multiple Hubs per user are supported; **one Hub per user is encouraged**.

### D2. Hub is the control plane, not the data plane

- The Hub owns inventory, access/tickets, the **activity feed** and **push**.
- It keeps the existing rule: the **Hub does not relay app traffic**.
- Live session streams go direct, or over the existing E2E relay.
- The client avoids N sockets with a **lazy connection pool**: it connects only to open or active sessions, about 8 sockets at most.
- Hub data-plane multiplexing (old O4) is **not built**. Revisit only on measured evidence, and then only as an ingress that forwards E2E ciphertext.

### D3. Per-user activity feed

- Each sandbox publishes **compact, user-friendly events** to its Hub:
  - the agent's final reply text of a turn;
  - messages from other people;
  - needs-me prompts;
  - turn finished/failed status.
- It never publishes tool calls, tool output, reasoning, streaming deltas or internal events.
- The Hub decides recipients from **its own ACL**, never from the sandbox. Recipients are the owner, watchers and anyone addressed.
- Feed is an append-only log per user with a cursor. Clients sync **one cursor per Hub**.
- The feed is a cache that can be **rebuilt from sandbox seq cursors**.

### D4. Previews: metadata-only or device-encrypted

- Org setting `feedPreview`:
  - `metadata-only` is the default for organizations;
  - `device-encrypted` is the default for personal Hubs.
  - A plaintext preview on the Hub is not an option.
- Device encryption:
  - Add a per-device **X25519 encryption key** (`nacl.box`, already used by `@clisbot/relay/e2ee`), separate from the existing Ed25519 device signing key (`packages/device-access/src/proof.ts`).
  - The device registers its public encryption key with the Hub, **signed by its signing key**.
  - Sandboxes seal each preview to each recipient device. The Hub stores ciphertext only.
  - Revoking a device drops its key.

### D5. Push from the Hub, id-only, coalesced

- The device token is registered with the Hub account, not with each daemon.
- The Hub sends **at most one push per session per burst**, with a per-user rate limit. There is no push for Others unless the user watches the session.
- Payload: ids plus an optional device-encrypted preview, sent through the **Clisbot push gateway** (Expo Push today). This is the same for cloud, self-hosted and personal Hubs. A self-hosted Hub does **not** need its own app; only a white-label app would need its own APNs/FCM credentials.
- Prefetch:
  - On iOS, a Notification Service Extension prefetches.
  - On Android, the data-message handler prefetches.
  - Each does one feed delta call and writes the text tier into the shared local store (O2).
  - Budget per run: ≤ 50 KB feed, ≤ 20 sessions, ≤ 2 MB.
- Air-gapped organizations can disable push; the client then syncs on open or through the desktop tray connection.

### D6. Legacy direct push

Per-daemon Expo push remains only for Hosts not enrolled in any Hub, then is deprecated once personal-Hub onboarding is the default.

## 3. Security requirements

- Sandboxes publish only for their own serverId, using their relationship credential. Events are schema- and size-validated, rate-limited per sandbox and coalesced.
- Feed and counts are computed after the Hub's access check. No existence leak.
- Revocation of a user, device or Host immediately:
  - purges the affected feed entries;
  - invalidates the user's cursors and push tokens;
  - triggers a client cache wipe on the next 403.
- Multi-tenant isolation per organization, encryption at rest, and audit logs for device registration, access and revocation.
- Push payloads never contain plaintext content.

## 4. Load and stability targets

Estimate for 100 sandboxes × 50 sessions/day × ~20 user-facing events:

| Item         | Target / estimate                                                |
| ------------ | ---------------------------------------------------------------- |
| Feed events  | ~100k per day (~1.2/s average)                                   |
| Feed storage | ~50 MB per day, 30-day TTL ≈ 1.5 GB, Postgres partitioned by day |
| Push volume  | ≪ events (coalesced)                                             |
| Client sync  | 1 indexed cursor query per open/push                             |

- Reconnect storms: daemons and clients use jittered backoff, admission limits and cursor resume.
- Noisy sandboxes are capped by event quotas.
- Enterprise deployment runs ≥ 2 stateless instances behind a load balancer, with Postgres backups and a push queue.
- A Hub outage degrades the service but does not take it down: clients use the cache and direct/relay streams.
- Metrics: events/s per sandbox, feed lag, push success, queue depth, reconnect rate.

## 5. Consequences

- **Positive:**
  - One client path for freshness and push at any scale (1 feed + 1 push source per Hub).
  - Plaintext stays off the Hub.
  - Hub load is small and predictable.
  - Consistent across personal and enterprise use.
- **Negative / costs:**
  - A personal Hub must be always-on for push (recommend a home server, VPS or hosted Hub).
  - Adds an iOS NSE target, an App Group and shared secure storage.
  - Adds a device encryption key lifecycle.
  - Daemons need a publish client.
- **Rejected alternatives:**
  - Per-daemon feeds and push as the primary model: N push sources, no cross-host coalescing.
  - Hub data-plane multiplexing: heavy load, plaintext exposure risk.
  - Plaintext previews on the Hub.

## 6. Open questions (to settle before implementation)

1. Publish transport from daemon to Hub: reuse the existing relationship channel, or a dedicated authenticated endpoint.
2. Who seals previews when there are many devices per user: the sandbox (needs recipients' device keys from the Hub), or a per-user key wrapping scheme.
3. Exact event schema and the dedupe key (session id + seq + kind).
4. Push gateway: stay on Expo Push or move to an owned gateway (cost, rate limits, data residency).
5. Load test environment: 100–500 synthetic sandboxes and 1k users.
