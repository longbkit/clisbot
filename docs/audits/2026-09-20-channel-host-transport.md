# Which way the channel plane reaches a Host

**Decided 2026-09-20. Supersedes the dial-out default in the [OpenClaw channel-reuse plan](2026-08-23-openclaw-channel-reuse-plan.md); the mechanism is now described in [the channel platform](../features/channels/README.md#reaching-a-host).**

## What went wrong

A bot answered one Slack message in three. The failures were not random:

| Time (2026-09-20) | What the Hub logged                                                    |
| ----------------- | ---------------------------------------------------------------------- |
| 19:51:31          | `Creating agent …` — the daemon received it                            |
| 19:53:32          | `agent create failed` after 30 s; the daemon logged nothing            |
| 19:56:04          | the same, again                                                        |
| 20:00:36          | `channel daemon disconnected` — 29 minutes after the socket went quiet |

The Hub believed it was connected for 29 minutes while nothing it sent arrived. Each failed create left the thread's pending marker in place, so every later message in that thread answered "agent create in progress; try again shortly" for good.

## Why

The channel plane dialed **out** from the Hub to the daemon, using the daemon's `ConnectionOffer` candidates. An ordinary Host is private — no public address, nothing dials in — so the only candidate was the public relay, and every channel operation left the Hub and came back to the same machine. That day the daemon's relay link flapped constantly (33 `relay_control_disconnected` in the 17:00 hour alone).

The daemon watches its own relay socket (ping 10 s, stale 30 s, `server/src/server/relay-transport.ts:56`) and cuts a dead one. The Hub's channel client had no such watch: it answered pings and never sent one, so a socket whose far side had gone looked healthy until something was written to it.

The web app kept working throughout, because the browser talks to `127.0.0.1:6768` directly. Nothing in the UI disagreed, because every status the app showed was about a different connection.

## Options

| Option                                                 | Why not                                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Add a ping/stale watchdog to the Hub's dial-out client | Treats the symptom. The relay hop stays, and a private Host still cannot be dialed without it.                  |
| Pin `PASEO_HUB_CHANNEL_DAEMON_URL` to loopback         | Works for a Hub and daemon on one box, which is the dev machine and not a deployment.                           |
| Drive the Host over the socket it already holds        | **Chosen.** No new connection, no relay hop, and reachability becomes a fact the Hub holds rather than a guess. |

## The decision

The channel plane speaks its ordinary session RPCs over the connection the Host opened to the Hub — the same socket automations use. The daemon attaches it as a full session on its side (`server/src/server/hub/relationship-controller.ts` `attachSocket`), so nothing new is needed on the daemon at all.

Consequences worth knowing:

- **Liveness is not measured.** The Hub is the server for the socket. A Host that is away fails the call at once with `host_not_connected`; reconnect is the daemon's job and it already does it.
- **One fact, two screens.** `presence` on the `daemons` resource is both "the Hub holds this Host" and "channels on this Host can answer". Settings → Hosts shows it per Host, a Route row shows it for the Host that Route runs on.
- **Dialing out is now a choice, not a default.** An explicit daemon target still dials, and so does an account whose Host the Hub cannot resolve.

## What riding the enrollment changed

The dial-out client held a trusted local session, which carries every authority. Riding the Host's
own connection means the channel plane is bounded by what that Host granted its Hub — which is the
point, but `hub.execute` alone refused `workspace.create.request`, `set_agent_model_request`, the
provider and model lists, and `agent.fork_context.request`. A refusal was worse than a denial: the
registry consumed the `rpc_error` frame as if it were an execution reply, so the caller waited out
its 30 s timeout with nothing to show.

Both are fixed at the source rather than per operation. A Hub connection now asks for the set a
client needs ([permissions](../permissions.md)), and an `rpc_error` for a request the execution
path never made is handed to whoever did.

## Sending it back

The session channel is the piece worth contributing: "drive an enrolled Host as
an ordinary session over the socket it already holds" carries no Clisbot
concept, and Hub automations are the obvious second consumer. If `getpaseo/hub`
takes `DaemonSessionChannel` / `DaemonSessionAccess` and the unmatched
`rpc_error` hand-off, the overlap from this change collapses to the
`publishDaemonSessions` seam. The default permission set is not PR-able — it is
what this product needs, not what upstream's Hub uses.

## Still open

A failed create still leaves its pending marker behind, so the thread that failed stays wedged even after the Host returns (`channels/bindings/index.ts` `settleCreationFailure`). Releasing it on a definite failure, and re-driving the inbound after a reconnect, are a separate change. It is finding 1 in the [stability and scalability audit](2026-09-20-channel-stability-scalability-audit.md).
