# Connection resilience (Offline O1)

A company Hub can front a hundred or more sandbox Hosts. At that scale something is always
unreachable, so the unit of failure is one source (a Host or a Hub), never the app. This doc
records the parameters and rules the app follows so one bad source cannot freeze, hide or
flicker everything else. Problem statement and later phases live outside the repo in the
Offline Experience proposal (O1 → O2 → O3, approved 2026-10-25). O2's first slice, the bounded
tail cache and Settings → Storage, is [offline cache](offline-cache.md).

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
- On web and Electron, the window `online` event makes every offline Host drop its remaining
  backoff and try now, still through the connect limit; `offline` verifies live sockets so they
  report offline promptly (`runtime/network-reachability.web.ts`). Native has no network-change
  signal yet and relies on foreground; NetInfo needs a native rebuild and is deferred to O2.
- Admission sessions and probe sockets take a connect slot. A self-retrying client's
  `connect()` can stay pending across retries, so it is not gated.
- `DaemonClient` keeps its unjittered default; only the app opts in, so CLI and daemon timing
  do not change.

Measured in `host-runtime-fleet.test.ts` with fake timers (100 Hosts, 10 simulated minutes; Node
simulation, not device evidence):

| Scenario                                     | Fixed 2 s tick (before)  | Backoff (O1)         |
| -------------------------------------------- | ------------------------ | -------------------- |
| Connects per unreachable sandbox (10 of 100) | 298–300 (2,989 total)    | 21–29 (249 total)    |
| Connects in flight                           | no limit in the old code | at most 4            |
| Network flip, all 100 down for 5 min         | not measured             | 1,591 to recover     |
| Hub ticket requests, Hub down, sandboxes up  | 12,000                   | 2,420                |
| Hub daemon-list reads, Hub healthy           | 10                       | 10                   |
| Hub daemon-list reads, Hub failing           | 10                       | 5 typical, 6 at most |

The "before" column replays the old 2 s pacing with the new connect limit still on. A ticket is
requested once per attempt whose transport to the sandbox opened, so an unreachable
sandbox costs no ticket requests. Probe intervals stay at one per Host for the whole run and drop
to zero when Hosts are removed.

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

The desktop main process refreshes the Hub sign-in itself (`packages/desktop/src/features/hub-client.ts`).
Access tokens last 5 minutes, so it refreshes every few minutes, and it ends the sign-in only when
the Hub answers `400 invalid_grant`, as the browser and native transports do. A network error,
timeout (15 s), 5xx or 429 keeps the stored credential, fails that request as unreachable and
retries on the next one. It logs the reason either way (`[hub-client]` in the main-process log).

A request with no HTTP answer fails as `HubUnreachableError`. `classifyHubFailure` maps 401 to
needs-sign-in, 403 to revoked, and everything else (network, timeout, 5xx) to unreachable.
Unreachable never hides or wipes data.

The daemon list polls every 60 s while the Hub answers, then backs off (jittered, doubling) to
at most 5 min after consecutive failures. A read the query cancelled is not counted as a failure.
Signing in again (password, Google, or a sign-in in another tab) reads the list at once and
replaces a read still in flight: the account keeps the same query key, so a list refused with
401 would otherwise stay refused until the backed-off poll (`clisbot/hub/account-provider.tsx`).

A Hub answer of 401 or 400 to a ticket request never removes a Host: 401 says the app's token was
refused and 400 that the request was wrong, so the Host stays and the Hub shows "sign in"
(`isAccessRevocation` in `packages/protocol/src/managed-access.ts`). Only a 403, 404 or 410 (or the
Host's own revocation close) ends the account's access to the Host. On Android, a request the Hub
refuses with 401 takes a new access token once and asks again, as the desktop client does; a second
401 is returned to the caller (`NativeHubTransport.request`).

A Hub Host removed while the Hub still lists its daemon (a refused ticket) is added back with a
doubling wait. The removal reads the list again, once per account however many Hosts were
removed (each joins the read in flight), and the wait starts only when that read answers. While
the list answers 401 or 403, nothing is added back: the Hub would refuse the ticket again, and
with an expired sign-in every Host of that Hub looped through remove and re-add. The first list
the Hub serves again, after signing in, adds the Host back after the base wait of 1 s
(`clisbot/hub/host-synchronization.tsx`).

**Known issue (2026-10-30, Android, open):** after the app is force-stopped or reinstalled over
itself (`adb install -r`), it can come back showing the Hub as **Cần đăng nhập / Needs sign-in**
with 0 Hosts, and the home screen as "No Host connected" or the Welcome screen. Pressing
**Continue in browser** opened a Chrome custom tab once, which closed at once; later presses did
nothing and showed no error. Force-stopping and reopening the app again restored the sign-in and
all 14 Hosts with no other action, so the stored credential was intact. Two faults to fix: the
transient needs-sign-in state after a cold start, and a sign-in button that stays silent while an
earlier browser auth session is still registered. When measuring on a device, a needs-sign-in
screen after a reinstall is this issue, not lost data: reopen the app before anything else.

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

Navigation V2 reads these states to decide what is live: a listable source that is `offline`,
`needs-sign-in`, `revoked`, still on its first connection or not measured yet is cached, and its
sessions are not shown as Running, as an approval to give, or as Done
([Sources removed and cached](../navigation-v2/README.md#sources-removed-and-cached)).

Copy names the source and the next step. For a Hub that cannot be reached it suggests checking a
VPN without claiming the VPN is off (`describeSourceProblem`, `describeHubFailure`). The strings
live in their own `offline` i18n namespace (`packages/app/src/i18n/offline/`, en and vi; other
locales fall back to en), so they merge without touching the shared per-locale resource files.

## History fan-out

Inbox history gives each Host 5 s. After that the page shows the Hosts that answered and lists
the rest in `lateHosts`; if none answered, it waits for the first. A late Host's rows merge into
the page its fetch built, in chronological place, without moving rows already shown. A late
failure becomes a named Host error. A fetch id keeps a late answer out of a newer refetch.

## Not in O1

- Lazy connections and Hub multiplexing (fewer sockets and tickets): O4, needs an ADR and Hub
  work.
- Native OS network-change events (NetInfo): O2.
- Timeline tail cache, outbox: O2 and O3.
