# Web Chat Channel Architecture (Design)

- **Created**: 2026-07-03
- **Status**: Design ready; implementation not started (deliberately light until backend Phases 2-3 land)
- **Purpose**: make clisbot's own web chat a first-class channel — a cowork-style React surface that is *less* limited than external chat platforms because we own both ends — with cross-surface session sync (a Slack conversation is visible and continuable from the web view when the viewer has permission).

## Product Framing (principal product view)

The web surface is not "another chat integration". It is the reference surface: the one place every runner capability can render natively without a platform ceiling.

| Job to be done | External channel (Slack/Telegram) | Web surface |
| --- | --- | --- |
| Read live progress | edited messages, throttled | true streaming, token/tool granularity |
| Approve a tool permission | text-based approve flow (Phase 2) | native approval card with allow-once/always |
| Steer / stop / queue | slash commands | first-class buttons on the running turn |
| Inspect a session (transcript, plan, usage, cost) | `/transcript`, `/status` snippets | session panel with the full RunEvent log |
| Cross-device continuity | per-platform threads | one session list across every surface |

Non-goals now: multi-tenant SaaS auth, mobile apps, collaborative cursors. The design must not block them; it must not build them.

## Architecture (principal engineer view)

The web surface rides the same boundaries the repo already enforces — it is a channel plugin plus one new read path, not a new system:

```text
React app (SPA, separate package/dir: web/)
  │  HTTPS + token (existing api-key auth model)
  ├── send:    POST /api/v1/:botId/events            (existing API channel ingress)
  ├── control: POST .../events/:id/stop, /steer, ... (existing + capability-gated)
  └── live:    GET  /api/v1/:botId/sessions/:sessionKey/events   ← NEW: SSE stream
                     └── RunEventFeed (new, agents-owned)

RunEventFeed (the one new abstraction)
  - subscribes to SessionService run lifecycle + RunnerBackend onEvent stream
  - fan-out per sessionKey: bounded ring buffer (replay last N) + live SSE
  - backend-agnostic: ACP feeds structured RunEvents; tmux feeds coarse
    snapshot-diff events through the same model
```

Design rules:

1. **The web channel consumes `RunEvent`, never backend artifacts.** The contract work (Phase 0/1) already normalized this; the feed is a fan-out, not a translation layer.
2. **Session sync is identity + permission, not new state.** A web viewer sees a Slack-originated session because both surfaces resolve to the same `sessionKey` (existing `session.identityLinks` + routing policy) and the viewer's principal passes the existing auth roles (`viewer` needs read permission; steer/stop follow the same role checks as chat). No second session store.
3. **One ingress pipeline.** Web messages enter through the API channel's ordered ingress exactly like webhook events — admission, queue/steer semantics, and follow-up policy stay identical across surfaces by construction.
4. **Capability-gated UI.** The React app reads the provider-by-backend capability matrix (served from the catalog) and renders only truthful controls: steer button on tmux sessions, interrupt-and-redirect labeling on ACP sessions, no shell button on ACP.
5. **Observer model unchanged.** The SSE feed is one more `RunObserver`; observer failure must never affect run supervision (existing run-supervision rule).

### Sync semantics (Slack ↔ Web)

- Session list: `GET /sessions` returns sessions the principal may view (filter by agent auth + route policy), each with surface bindings ("origin: slack #ops-room").
- Opening a session replays the ring buffer (last N RunEvents + last settled transcript) then goes live.
- Messages sent from web appear in the session; the Slack thread keeps receiving its normal observer updates. Both are observers of one run — no echo suppression needed beyond existing observer identity.
- Permission: default deny; `owner`/`admin` see everything their agent scope allows; share-with-role is config, not code.

### Why SSE (not WebSocket) first

One-directional live updates + existing HTTP listener + trivial proxying. Input already has a POST path. WebSocket is an upgrade later if bidirectional latency matters (typing indicators, collaborative presence) — the feed abstraction does not change.

## UX sketch (principal designer view)

Cowork-shaped, three panes, keyboard-first:

```text
┌ sessions ──────┬─ conversation ─────────────────────┬─ session panel ─┐
│ ● ops-room     │ turn stream:                       │ agent: codex    │
│   (slack)      │  ▸ user prompt                     │ backend: acp    │
│ ● web-draft    │  ▸ assistant text (streaming)      │ caps: ✅ stop   │
│ ○ tele-topic   │  ▸ ⏺ tool card [running]           │       ↻ steer*  │
│ + new session  │  ▸ 🔐 permission card [allow][deny] │ usage/cost      │
│                │ composer: [text] [queue] [steer]   │ event log       │
└────────────────┴────────────────────────────────────┴─────────────────┘
* steer on ACP renders as "interrupt & redirect" with its truthful tooltip
```

Interaction rules: permission cards block only their own turn; queue vs steer is explicit (no silent interrupt from plain Enter — matches D4); every degraded capability shows the same truthful copy chat users see.

## Delivery Plan

| Step | Scope | Depends on |
| --- | --- | --- |
| W-1 | `RunEventFeed` + SSE endpoint on the API channel, auth-gated; evidence via curl transcript | none (contract already ships events) |
| W-2 | Minimal read-only demo page (single static HTML/React, session list + live stream) | W-1 |
| W-3 | Send + stop/steer/queue controls, capability-gated | Phase 2 chat-native parity |
| W-4 | Permission approval cards | Phase 2 interactive permissions |
| W-5 | Full React app package, session panel, cost/usage | Phase 3 operator surfaces |

The demo stays deliberately tiny (W-2) until backend Phases 2-3 stabilize the event vocabulary; investing in the full app before that would bake in churn.

## Risks

- **Event replay durability**: ring buffer is in-memory; a runtime restart drops replay history (live sessions resume via stored transcript). Durable event logs join the existing storage-standardization task if needed.
- **Backpressure**: many SSE observers on one run multiply fan-out; bounded per-observer queues + the global admission task cover this.
- **Auth surface growth**: web tokens reuse the API channel's key model now; SSO/OIDC is a later, isolated concern.
