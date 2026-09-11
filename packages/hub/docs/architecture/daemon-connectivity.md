# Daemon connectivity

How the Hub and execution daemons connect. There are **two WebSocket sockets,
pointing opposite directions** — keep them straight before debugging any
"can't reach the daemon" symptom.

## Two sockets, opposite directions

**`/ws` — the daemon's own trusted-client server.** Lives on the **daemon**
(`packages/server/.../websocket-server.ts`, `127.0.0.1:6767`, exposed via
direct/relay). **Clients dial in.** Carries the **full interactive** wire,
`scopes:["*"]`: `create_agent`, `send_agent_message` (steer),
`agent_permission_response`, `agent_stream`/timeline, terminals, providers,
config.

**`/api/daemons/socket` — the Hub's endpoint.** Lives on the **Hub**
(`packages/hub/src/daemons/registry.ts`); the **daemon dials out** after enroll.
Carries **presence**, **connection-offer publish** (the daemon's direct+relay
endpoints → stored on `DaemonRecord.connectionOffer`), **managed-access** lease
control, and the **automation** `hub.execution.*` family —
`create`/`validate`/`control` (interrupt or archive) only, **no steer, no
approval** (frozen legacy-compat).

The socket is full-duplex, so `/api/daemons/socket` _does_ carry Hub→daemon
requests (create/validate/interrupt). What it lacks is not a direction but the
**interactive handlers** (steer, permission-respond) — those exist only on the
daemon's `/ws` session. So anything interactive must reach the daemon via `/ws`.

## Who uses which

- **paseo web / app / CLI / phone** → the daemon's **`/ws`** (with a Hub-issued
  `accessTicket` when the daemon is in managed-access `external` mode).
- **Hub channel supervisor** → the daemon's **`/ws`**, as an ordinary trusted
  client (the channel plane: create + steer + approvals + stream).
- **Hub automation, presence, and offer capture** → **`/api/daemons/socket`**.

## Connect modes (candidates come from the daemon's `ConnectionOffer`)

A daemon publishes a `ConnectionOffer` (`packages/protocol/src/connection-offer.ts`)
built from its own `PASEO_DIRECT_ENDPOINT` / config; the Hub persists it. It yields
up to three ways to reach the same daemon's `/ws`:

- **direct** — WSS to `offer.direct.endpoint` (VPN / in-cluster), via
  `buildDaemonWebSocketUrl` (`packages/protocol/src/daemon-endpoints.ts`).
- **relay** — E2EE through the relay from `offer.relay.endpoint` + `serverId`, via
  `buildRelayWebSocketUrl` + the relay-E2EE transport
  (`packages/client/src/daemon-client-relay-e2ee-transport.ts`).
- **loopback** — embedded Hub only: the daemon pid-lock `listen` / `127.0.0.1:6767`.

**App selection is latency-based**, not a fixed priority: the app probes its
candidates and keeps the lowest-latency one (with a few-probe hysteresis); direct
usually wins because it is faster, and relay is the reach-from-anywhere fallback.
The wire client itself only ever reconnects to its own URL; "failover" is the
caller re-pointing it at another candidate.

## Trusted-client concept

Every client — app, phone, CLI, **and the Hub** — connects the same way: `hello`
→ a **trusted session with `scopes:["*"]`**. The daemon cannot tell the Hub from a
phone; what makes the Hub the control plane is its own config/RBAC, not the wire.
When the daemon runs managed-access `external`, the client must carry a Hub-issued
`accessTicket` in the `hello`.

## How the channel supervisor connects (2026-09)

The channel supervisor connects exactly as any other trusted client:

- **Per-daemon target.** It resolves **each route's daemon → that daemon's stored
  `ConnectionOffer`** (`application-runtime.ts` `createChannelDaemonTargetFactory`),
  so the target is per-daemon (multi-daemon by construction, determined when the
  daemon connects). The global `PASEO_HUB_CHANNEL_DAEMON_URL` is only a fallback;
  `PASEO_HUB_CHANNEL_DAEMON_TRANSPORT` (`auto|direct|relay|loopback`) orders the
  candidates (`auto` = direct then relay).
- **Direct and relay.** `channels/daemon/ws-client.ts` dials a direct candidate
  straight; for a relay candidate it opens the same **relay-E2EE tunnel** the app
  uses (`@getpaseo/relay/e2ee` `createClientChannel`, keyed by the offer's
  `daemonPublicKeyB64`) and rides the trusted-client wire through it.
- **Failover + loud failure.** The reconnect loop rotates across candidates
  (re-preferring the top after a connected drop) and emits **one loud
  `channel daemon unreachable`** line per failed cycle instead of a silent
  `channel daemon disconnected` loop.

This stays **fork-local** in `packages/hub/src/channels/**` (dep `@getpaseo/relay`,
not `@getpaseo/client`) and leaves the daemon **unchanged** — it only dials the
daemon's existing `/ws`.
