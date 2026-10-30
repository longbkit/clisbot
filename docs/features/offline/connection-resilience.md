# Connection resilience (Offline O1)

A company Hub can front a hundred or more sandbox Hosts. At that scale something is always
unreachable, so the unit of failure is one source (a Host or a Hub), never the app. This doc
records the parameters and rules the app follows so one bad source cannot freeze, hide or
flicker everything else. Problem statement and later phases live outside the repo in the
Offline Experience proposal (O1 → O2 → O3, approved 2026-10-25). O2's first slice, the bounded
tail cache and Settings → Storage, is [offline cache](offline-cache.md).

## Reconnect pacing

| Parameter                 | Value                                                      | Where                                            |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Backoff                   | full jitter, `uniform(0, min(60 s, 1 s · 2^failures))`     | `packages/app/src/runtime/connection-backoff.ts` |
| Reset                     | on success, a changed route, an explicit retry, or a sweep | `HostRuntimeController`                          |
| Reconnect sweep           | Hosts that need a connect slot start 100 ms apart          | `packages/app/src/runtime/reconnect-sweep.ts`    |
| Connects in flight        | 16 per runtime store                                       | `ConnectLimiter`, shared by every controller     |
| Directory pages in flight | 3 per runtime store                                        | `DirectorySync` (`pageFetchLimiter`)             |
| App client auto-reconnect | full jitter, cap 60 s                                      | `createDefaultDeps` (`reconnect.jitter: "full"`) |

- Hub-managed Hosts own their retries in the controller (their clients never auto-retry). The
  2 s probe tick only attempts a Host whose backoff is due.
- A reconnect sweep runs when there is reason to think Hosts can connect again: the window
  `online` event (web and Electron, `runtime/network-reachability.web.ts`), the app returning to
  the foreground, and a Host that had failed connecting again. Online Hosts verify their socket
  and self-retrying clients reconnect at once; every other Host drops its backoff and tries now,
  100 ms after the previous one, still through the connect limit. Without a sweep the backoff
  holds, so a hundred unreachable sandboxes do not retry together.
- Native has no network-change signal (NetInfo needs a native rebuild). A failed Host connecting
  again stands in for it: when a VPN comes back, the first Host whose backoff falls due sweeps the
  rest. A recovered Host sweeps at most once every 10 s, so a fleet coming back sweeps once.
- The window `offline` event verifies live sockets so they report offline promptly and cancels a
  sweep still starting Hosts. An explicit retry (`runProbeCycleNow`, the user's Retry) skips the
  remaining backoff of one Host.
- A Host that reconnects asks for its directory with the stored cursors when it advertises
  `directorySync`, so it receives changes, not the whole list. Agent, workspace and project pages
  share three slots across Hosts, so 14 Hosts coming back do not fetch at once; a page that waited
  past a connection change is dropped instead of opening a stale subscription.
- Admission sessions and probe sockets take a connect slot. A self-retrying client's
  `connect()` can stay pending across retries, so it is not gated. A connect mostly waits on round
  trips, so the limit is sized for a company fleet to connect in one wave (it was 4 until
  2026-10-30, which made 14 Hosts on a 400 ms VPN connect in four waves).
- `DaemonClient` keeps its unjittered default; only the app opts in, so CLI and daemon timing
  do not change.

Measured in `host-runtime-fleet.test.ts` with fake timers (100 Hosts, 10 simulated minutes, a
connect limit of 4; Node simulation, not device evidence):

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

For the 2026-10-30 report (14 Hub Hosts behind a VPN, 0/14 for over 2 minutes after the VPN came
back), the same file holds 14 Hosts that each failed once and wait about 59 s: foreground, the
`online` event, or one recovered Host brings all 14 online within 5 simulated seconds, at most 4
connects in flight.

## Hub access tickets

Tickets are single use: the Hub stamps `consumedAt` when the daemon consumes one, and each lives
60 s (`packages/hub/src/managed-access/tickets.ts`). A cached ticket presented again is rejected,
so the app does not reuse tickets. A Host with no failure since it last connected requests its
ticket when the attempt starts, while the transport opens (`prefetchedAccessTicket`); the first
hello takes it. After a failure the ticket waits for the transport, so an unreachable sandbox
costs a ticket only on the first attempt after a reset (launch, a sweep, a Retry), and the backoff
above bounds how often a reachable one asks. Cutting
ticket calls further needs the Hub multiplexing gateway (O4).

## Cold start: adopt, never restart

The registry restores Hub-managed Hosts and their controllers start before the Hub list arrives.
When a Hub binding mounts, registering its ticket resolver re-runs admission if the binding or
advertised routes changed. The binding then waits for the registry to load (a write before it
would replace the stored profiles), writes the offer and calls `adoptHostConnection`: an online
or connecting controller is left alone, anything else gets one immediate attempt. A changed offer
still reaches the controller through the profile upsert.

## Cold-start connect path

Each step below costs whole round trips through the VPN. On 2026-10-30 a Galaxy S23 (14 Hub
Hosts, ~400 ms) showed 0/14 online 20 s after a force-stop and 14/14 only by 60 s.

| Step                     | Round trips | Runs alongside                                      |
| ------------------------ | ----------- | --------------------------------------------------- |
| Registry restore         | local       | the remembered daemon list restore                  |
| Hub binding              | none        | mounts from the remembered list                     |
| Hub access-token refresh | ~3          | transport open                                      |
| Transport open (relay)   | ~4          | the ticket request                                  |
| Access ticket            | 1           | transport open (first attempt after reset)          |
| hello → server_info      | 1           |                                                     |
| Account read, list read  | 1 each      | connects; the live list replaces the binding source |
| First directory fetch    | 1 per page  | sends the cached cursors, so it is a delta          |

Before 2026-10-30 these ran in series: bindings mounted only after the account and list reads,
so the first attempts opened a transport and then failed for want of a ticket resolver ("Sign in
to the Hub managing this Host"); the next ones were cut off when the bindings registered; then 14
connects ran four at a time, each opening the transport before asking for its ticket.
`clisbot/hub/hub-cold-start.test.ts` replays the report with fake timers: 12.8 s to 14/14 before,
2.0 s after (one wave of transport open and hello). Without a remembered list the Hosts connect
one wave after the live list, 4.0 s. The device took longer than either; the summary below says
where the rest went.

- **Bind from the remembered list.** `managedHostBindingList` binds the list this account last
  read until this run's list arrives, with the same binding keys, so the live list replaces it
  without reconnecting. Its ticket requests use the remembered organization through
  `api(organizationId)` before the account read answers. A Hub that answers signed out or another
  account drops the list, and its bindings unmount. Orphan removal and re-adding a removed Host
  wait for this run's list.
- **Ticket with the transport**: [Hub access tickets](#hub-access-tickets).
- **One wave**: the connect limit in [reconnect pacing](#reconnect-pacing).

`runtime/cold-start-connect.ts` records one `cold-start-connect` host diagnostic per app start
(read it with `await clisbotHostDiagnostics()` on web, or in the device log as
`[clisbot:host] cold-start-connect`): Hub-managed Hosts restored, how many came online, failed
attempts, and milliseconds from bundle start to the registry restore, the first Hub binding, the
account read, the list read, the first Host online and the last (null if the 60 s deadline came
first).

Only the Hub's answer removes a Hub-managed Host: signed out, another organization, a daemon the
list no longer offers, or the saved Hub forgotten (`orphanedManagedHosts`). A binding unmounting
removes nothing. Removing a Host clears its directory, and the tree under the Hub scope can remount
while the answer stays the same: on 2026-10-30 an Android resume unmounted all 14 bindings of a
fleet, and Home fell from 3,597 to 1,001 sessions while every Host showed online. On Android, Back
on Home moves the task to the back on every version (`plugins/with-android-back-keeps-task.js`),
and the compact layout holds across a resume (`navigation/compact-resume-hold.ts`).

Home's composer follows the same rule: it opens on the remembered Host and project from storage
and keeps them while Hosts connect; it moves only when the Host leaves the registry
([Home and Inbox](../home-and-inbox/README.md)).

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

The Hub answers an account read sent without a token with `signedOut`. Before the account accepts
that, the native transport reads the stored sign-in again after 500 ms and refreshes
(`recoverSignIn`); the read stays pending meanwhile, so it shows syncing, never "sign in". A 401 to
a request sent without a token takes the same single retry. Only `400 invalid_grant` deletes the
stored credential.

A Hub Host removed while the Hub still lists its daemon (a refused ticket) is added back with a
doubling wait. The removal reads the list again, once per account however many Hosts were
removed (each joins the read in flight), and the wait starts only when that read answers. While
the list answers 401 or 403, nothing is added back: the Hub would refuse the ticket again, and
with an expired sign-in every Host of that Hub looped through remove and re-add. The first list
the Hub serves again, after signing in, adds the Host back after the base wait of 1 s
(`clisbot/hub/host-synchronization.tsx`).

**Cold start after a force-stop or reinstall (Android, found and fixed 2026-10-30, device check
pending):** the app came back showing the Hub as **Cần đăng nhập / Needs sign-in** with 0 Hosts.
**Continue in browser** opened a custom tab once, which closed at once; later presses did nothing.
Reopening restored the sign-in and all 14 Hosts, so the credential was intact. Two faults, both
fixed:

- The account read went out without a token when the keystore read came back empty, and the Hub
  answered `signedOut`. The read now tries the stored sign-in once more first (above).
- expo-web-browser's Android auth session keeps module-private state and ignores the first
  AppState change after a cold start, so the closed tab left it registered: the sign-in never
  settled, the button stayed pending, and every later attempt failed as "already open". Android
  now runs the session itself (`clisbot/hub/transport/auth-session.ts`): closing the browser ends
  it after a 1 s grace for a late redirect, and a new press replaces a session still registered.
  iOS dismisses a registered `ASWebAuthenticationSession` before opening another. A browser that
  cannot open shows the error in the section and a toast with Retry.

Not yet confirmed on the Galaxy S23. If a needs-sign-in screen still appears after a reinstall,
reopen the app before treating it as lost data, and record it here.

## Remembered Hub daemon list

`hub-daemon-list-cache.ts` stores, per Hub origin, the last list the signed-in account read:
account id, organization id, daemons and `syncedAt`, in AsyncStorage under
`@clisbot:hub-daemon-lists:v1`.

- **Used** for visibility, when the live list is missing and the account is the same one, or its
  state could not be read. The inventory reports `lastSyncedAtByOrigin` for those Hubs.
- **Used** for bindings and ticket resolvers under the same rule, until this run's list arrives
  ([cold-start connect path](#cold-start-connect-path)).
- **Never used** for orphan removal or adding back a removed Host; those act on a fresh list.
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
- Native OS network-change events (NetInfo): need a native rebuild; a recovered Host sweeps the
  others instead.
- Timeline tail cache, outbox: O2 and O3.
