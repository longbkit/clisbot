# Connection resilience (Offline O1)

A company Hub can front a hundred or more sandbox Hosts. At that scale something is always
unreachable, so the unit of failure is one source (a Host or a Hub), never the app. This doc
records the parameters and rules the app follows so one bad source cannot freeze, hide or
flicker everything else. Problem statement and later phases live outside the repo in the
Offline Experience proposal (O1 → O2 → O3, approved 2026-10-25).

## Reconnect pacing

| Parameter                 | Value                                                  | Where                                            |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| Backoff                   | full jitter, `uniform(0, min(60 s, 1 s · 2^failures))` | `packages/app/src/runtime/connection-backoff.ts` |
| Reset                     | on success, a changed route, or an explicit retry      | `HostRuntimeController`                          |
| Connects in flight        | 4 per runtime store                                    | `ConnectLimiter`, shared by every controller     |
| App client auto-reconnect | full jitter, cap 60 s                                  | `createDefaultDeps` (`reconnect.jitter: "full"`) |

- Hub-managed Hosts own their retries in the controller (their clients never auto-retry). The
  2 s probe tick only attempts a Host whose backoff is due.
- Foreground and `ensureConnected({ verify: true })` verify live sockets at once. An offline
  managed Host keeps its backoff, so a hundred unreachable sandboxes do not reconnect together.
  An explicit retry (`runProbeCycleNow`, the user's Retry) skips the remaining backoff.
- Admission sessions and probe sockets take a connect slot. A self-retrying client's
  `connect()` can stay pending across retries, so it is not gated.
- `DaemonClient` keeps its unjittered default; only the app opts in, so CLI and daemon timing
  do not change.

Measured in `host-runtime-fleet.test.ts` (100 Hosts, 10 unreachable, 10 simulated minutes):
the previous fixed tick made about 300 attempts per unreachable sandbox (2,989 total); backoff
makes 21–29 (249 total), with at most 4 connects in flight. A network flip that drops all 100
sessions for 5 minutes costs 1,591 connects to recover, all within the limit.

## Hub access tickets

Tickets are single use: the Hub stamps `consumedAt` when the daemon consumes one, and each lives
60 s (`packages/hub/src/managed-access/tickets.ts`). A cached ticket presented again is rejected,
so the app does not reuse tickets. The client asks for a ticket only after the transport to the
sandbox opens, so an unreachable sandbox costs no ticket, and the backoff above bounds how often
a reachable one asks. Cutting ticket calls further needs the Hub multiplexing gateway (O4).

## Cold start: adopt, never restart

The registry restores Hub-managed Hosts and their controllers start before the Hub list arrives.
When a Hub binding mounts, registering its ticket resolver re-runs admission if the binding or
advertised routes changed. The binding then calls `adoptHostConnection`: an online or connecting
controller is left alone, anything else gets one immediate attempt. A changed offer still
reaches the controller through the profile upsert.

## Hub requests

Browser, browser OAuth and native OAuth transports abort a Hub request after 15 s, including a
body that stalls after the headers (`transport/request-deadline.ts`). The Electron bridge cannot
be aborted from the renderer, so the renderer stops waiting at the same deadline. Paired Hubs
already had 8 s handshake and 16 s request deadlines in `HubDeviceTransport`.

A request with no HTTP answer fails as `HubUnreachableError`. `classifyHubFailure` maps 401 to
needs-sign-in, 403 to revoked, and everything else (network, timeout, 5xx) to unreachable.
Unreachable never hides or wipes data.

The daemon list polls every 60 s while the Hub answers, then backs off (jittered, doubling) to
at most 5 min after consecutive failures.

## Remembered Hub daemon list

`hub-daemon-list-cache.ts` stores, per Hub origin, the last list the signed-in account read:
account id, organization id, daemons and `syncedAt`, in AsyncStorage under
`@clisbot:hub-daemon-lists:v1`.

- **Used** only for visibility, when the live list is missing and the account is the same one,
  or its state could not be read. The inventory reports `lastSyncedAtByOrigin` for those Hubs.
- **Never used** for bindings, ticket resolvers or orphan removal; those act on a fresh list.
- **Replaced** by every successful list, so a delisted daemon disappears.
- **Removed** on explicit sign-out, when the reachable Hub reports signed out or a different
  account or organization, and on a 403 from the list. `onAccessRevoked` still removes the Host
  from the registry, which hides it whatever the list says.

## Source health

`runtime/source-health.ts` keeps one entry per Host, recomputed only on that Host's runtime
events. Entries are shared structurally, so per-source selectors (`useSourceHealth`) and the
summary (`useSourceHealthSummary`) re-render only when what a source shows changes.

| State           | Meaning                                              |
| --------------- | ---------------------------------------------------- |
| `live`          | online, directories current                          |
| `syncing`       | first connection, or online and catching up          |
| `offline`       | unreachable; cached data as of `lastSyncedAt`        |
| `needs-sign-in` | the Host's password, or its Hub's sign-in, is needed |
| `revoked`       | the Hub removed this account's access                |

- Entering `offline`, `needs-sign-in` or `revoked` waits 3 s. An offline source leaves that
  state only when it is online again, so retry attempts do not flip it back and forth.
- `lastSyncedAt` is written when a connection opens or closes, never per event, and persists
  under `@clisbot:source-last-synced:v1`.
- Each Hub account publishes its own state (`live`, `syncing`, `unreachable`, `needs-sign-in`,
  `revoked`) from its existing list query, so health readers add no query observers. A Hub's
  sign-in or revocation answer overrides its unreachable Hosts; a reachable Host stays live
  whatever its Hub says. Summaries give each Hub's `reachable/total`.
- `useDirectoryHealth` keeps its shape. It is `unavailable` only when no selected source can
  refresh and `loading` only when none has anything to show; `degraded` lists the sources that
  cannot refresh.

Copy names the source and the next step. For a Hub that cannot be reached it suggests checking a
VPN without claiming the VPN is off (`describeSourceProblem`).

## History fan-out

Inbox history gives each Host 5 s. After that the page shows the Hosts that answered and lists
the rest in `lateHosts`; if none answered, it waits for the first. A late Host's rows merge into
the page its fetch built, in chronological place, without moving rows already shown. A late
failure becomes a named Host error. A fetch id keeps a late answer out of a newer refetch.

## Not in O1

- Lazy connections and Hub multiplexing (fewer sockets and tickets): O4, needs an ADR and Hub
  work.
- OS network-change events: the app reacts to foreground (`AppState`) only. There is no
  network-change hook to reuse yet.
- Timeline tail cache, outbox: O2 and O3.
