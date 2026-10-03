# Device pairing and optional Hub implementation

Accepted behavior: [device-pairing.md](device-pairing.md). The 2026-10-03 v11 design is the
UI reference; existing product owners and contracts remain authoritative.

This work extends the existing device-pairing implementation. Prior verification in the
decision document does not verify the new flows below. Status and release evidence must
distinguish implementation, automated checks, live platform execution and publication.

Live personal-onboarding verification on 2026-10-03 found that HTTPS terminated by
Tailscale Serve reached the gateway as HTTP, so the HTML bootstrap incorrectly suggested
an insecure WebSocket. The hint now uses the browser page protocol rather than proxy
headers; direct HTTP still uses WS and HTTPS uses WSS. The existing web-serving suite
covers both. Fresh browser storage successfully paired through the real Tailscale
gateway, followed by successful operator-manual pairing in a separate Chrome profile
(`Manual dev browser`, encrypted handshake and `/open-project` confirmed). The original
profile's timeout has not been reproduced; this bootstrap fix alone does not establish
its cause.

## Hub Overview and account sign-in follow-up

The post-start route carries the paired Hub ID, but a success notice requires authenticated
Hub capabilities before rendering. Ordinary Overview uses one SettingsCard for Connection,
Account sign-in and Paired devices, followed by the existing remembered help disclosure.
Account sign-in controls open `/settings/hub/sign-in`; Instance settings links there instead
of placing the full owner form beside provider applications. The Account tab and Sessions
remain unchanged.

An optional, operator-only `ownerLoginConfigured` capability reuses the backend's existing
login-method check. It reveals no account address and changes no authority or defaults. The
form validates email/password before requests, preserves a draft during capability refresh,
locks Hub switching, distinguishes sign-in from pairing recovery, and reuses a successful
owner-login setup if a subsequent policy update fails. The server remains the authority.
Node and Start/SSR artifacts must both be built for live Hub validation.

Verification: focused app regressions and the embedded Hub authority integration pass.
Real Tailscale browser checks cover wide/narrow Overview, post-start confirmation, the
focused policy page, visible owner fields, validation, switch locking and paired-device
navigation without changing the live dev Hub's login policy. Hub identity/key/policy and
both daemon process start times were preserved. Existing settings layout changes across
the desktop/compact boundary remount forms; draft retention here covers capability refresh
within the same layout, rather than cross-layout persistence.

Scope exception: the existing `device-access/hub-settings.tsx` monolith and its onboarding
controller already exceed the extension limits. This follow-up extracts policy and capability
logic into focused modules and reduces that file; a full onboarding decomposition is outside
this UX fix. New modules and changed Overview components stay within the hard limits.

## Hub action hierarchy follow-up

Connection/start/save forms now explicitly use the product's accent Button variant; the
component default remains neutral. Cancel is outlined and grouped inside the form, and the
narrow layout gives its primary action a full row. Recovery/navigation actions remain outline
or ghost according to `docs/design.md`. Shared Button exposes loading through `aria-busy` on
web; it retains the existing geometry, colors, default variant and native accessibility state.

Public identity reads reuse one bounded, unauthenticated helper with a deadline through the
response body. Timeout, network failure and malformed response have human-readable messages
inside the connection form, rather than a raw browser abort reason beneath the page. Inputs
and actions lock during requests; failure restores them for retry without saving a profile or
granting authority. Editing the URL clears the old target's setup notice. Host discovery
progress/errors stay on the listing rather than shifting an open setup/connection form.

Focused onboarding, identity-read and Account regressions pass (63 cases), with App typecheck
and scoped lint. CLI Playwright uses the dedicated dev browser profile plus a separate empty
dark context, without changing its settings or credentials. Wide/narrow screenshots and actual
keyboard focus, pending, timeout/retry and network failure checks are under
`.debug/scratch/hub-action-ux/`. Enabled primary text contrast is 5.74:1 and Cancel is over
15:1 in Light/Dark; this is scoped action verification, not full WCAG certification. The
comparison follows the [WCAG text contrast criterion](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
No company Hub connection was attempted; controlled public metadata responses exercise the
error UI without pairing, owner creation or login-policy mutations.

## Delivery checklist

| Area              | Required result                                                                                                                      | Status                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Optional Hub      | Opening a client starts/reuses only the daemon; explicit Start Hub on a connected Host; reuse without restarting daemon              | Verified locally                                           |
| Serving           | Existing CLI commands; no new public `serve`; independent daemon, Hub and web/gateway lifecycle; fixed route ingress                 | Verified locally                                           |
| Connectivity      | Tailscale guidance and preference, independent Hub E2EE relay, local/public HTTPS alternatives                                       | Verified locally; deployment gates below                   |
| Personal access   | No account required by default; combined pairing with independent credentials; starting Hub later explicitly approves current device | Verified locally                                           |
| Account entry     | Owner ready: URL to login without pairing; owner incomplete: operator-approved pairing plus separate one-use owner setup approval    | Verified locally; provider gate below                      |
| Google            | Hub-bound nonce and device transaction; verify ID token and reuse admission/linking; direct and relay adapters                       | Implemented and tested; real provider gate below           |
| Managed access    | Existing external tickets/grants, no pairing bypass; off retains independent daemon authority                                        | Verified locally                                           |
| Hub UI            | Multi-Hub profiles, discovery-first, shared persistent help, Overview and consistent selectors; lock switching during edits          | Verified by scoped UI checks                               |
| Account UI        | Reuse existing Account and Profile; add Sessions, own-account sign-out, immediate authority invalidation                             | Verified by scoped UI checks                               |
| Device management | Labels, stable identity, active connections and independent backend revoke; bounded plain-text labels                                | Verified by scoped UI/backend checks                       |
| Compatibility     | Optional wire fields/capabilities, feature-off regression checks, isolated extension modules                                         | Verified by scoped checks                                  |
| Packaging         | Updated web/mobile/desktop/CLI source and package checks; platform execution/publication reported separately                         | Local artifacts verified; platform/publication gates below |

## Work ownership

- Hub authority worker: authentication, setup, Google admission and account sessions.
- Lifecycle worker: CLI, detached services, Electron startup and backend packaging.
- App worker: client UI, profiles, onboarding and app transport adapters.
- Primary agent: shared protocol/client contracts, authorized Host-local Hub launcher,
  integration, documentation, security review and final verification.

Live user services and pre-existing user edits are outside the test lifecycle. Checks use
isolated homes/ports and stop only owned processes. The private baseline snapshot is under
`.debug/scratch/device-pairing-implementation/`.

## Authority and recovery review

The final backend review covered the owner chain from invitation to device proof, account
admission, managed ticket/lease and revocation. Personal owner projection reuses the existing
user, organization, membership and capability resolver. It does not create a second role
system. Review fixes included:

- Initialized account Hubs use stateless, signed, Hub/device-bound login entry. Anonymous
  state reads and failed authentication do not occupy consumed-challenge slots. Account
  mutations serialize per challenge; only an admitted login records consumption. Flood,
  retry and concurrent-success regressions verify this distinction.
- First-owner setup requires a separate hashed approval, bound to the paired device and
  consumed in the existing owner-claim transaction. Password and Google paths enforce it.
- Google token verification checks signature, issuer, audience, expiry and the Hub-issued
  device nonce before consuming authority. Invalid tokens cannot saturate the transaction
  ledger. The managed page returns popup tokens only to the official app origin.
- Account sessions are explicitly associated with device credentials and managed
  tickets/leases. Exact-session sign-out removes refresh authority, commits revocation
  before notification and closes that session's active access. It is not a permanent
  device/account ban. Revocations missed during a daemon outage replay on its authenticated
  ready handshake; lease expiry remains the offline bound.
- The fixed encrypted Hub ingress bounds request/response bodies, concurrency, rates,
  handshake lifetime and cancellation. It is not an arbitrary URL proxy and does not use
  the daemon as the Hub tunnel.
- Changing an enrolled Host from `external` to protected `off` does not mint a daemon
  credential. The expected connection rebind uses 4410 rather than the permanent
  revocation callback (4403). The UI explains independent pairing and offers the existing
  pairing flow; a saved daemon credential or verified local Desktop operator can reconnect
  normally. Actual-process tests verify ticket-only rejection, independent credential
  admission and exact permanent revoke notification separately.

The final UI pass uses the accepted v11 hierarchy, card/help anatomy and existing borderless
Host selector style. Actual browser checks cover desktop and narrow layouts, light/dark,
autocomplete, shared help persistence, edit locks through failed saves, personal/initialized
account entry and Account Sessions after reload. Native iOS/Android renders verify the
same hierarchy, full title, bounded selector height and reachable scoped Host navigation.
Component/backend tests cover discovery failures, setup/revoke/identity recovery and scope
races. This is scoped production-state verification, not a claim of 44 artboard screenshot
passes or pixel-identical fixture labels.

## Verification evidence

Evidence is task-scoped and does not claim a passing full monorepo suite. Logs and screenshots
are retained under the ignored `.debug/scratch/device-pairing/` and
`.debug/scratch/device-pairing-implementation/` directories.

| Surface                                     | Actual local evidence                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared device authority                     | 11 focused tests, including cross-process one-use redemption, hash-only storage, stable identity, expiry, proof binding/replay, label validation and revoke.                                                                                                                                                                                                                                                                  |
| Hub auth and authority                      | 44 distinct focused tests across 14 files: pre-login flood/retry/concurrency, protected setup, Google verification/admission, exact Account Sessions, policy upgrade, fixed ingress and feature-off compatibility. Typecheck and focused lint pass.                                                                                                                                                                           |
| Host-local Hub startup/discovery            | 9 tests: independent owner capability, safe installed CLI/Electron invocation, foreign relationship and endpoint rejection, bounded public discovery and omitted loopback-only remote routes.                                                                                                                                                                                                                                 |
| Client and App UI                           | 173 focused App tests across 17 files pass, including multi-Hub scope/races, shared help, edit locks, owner recovery, bounded identity reads, device storage, native-safe handoff and Start-Hub capability rejection. Full App typecheck and focused lint pass.                                                                                                                                                               |
| Managed access transition UI                | 10 tests across the existing transition suite and independent-credential helper; server 55 tests across three files and client 181 tests cover rebind/admission/revoke, including framed and legacy missing-credential closes. These suites overlap other scoped checks; counts are not summed.                                                                                                                               |
| Real backend processes and production relay | Actual daemon/Hub/gateway sockets: daemon-first pairing, later Start Hub without socket/PID restart, combined pairing, independent crash recovery, stable Hub ID, preserved relay routes, mandatory owner setup, external/off transitions, exact revoke and reconnect. Production relay transport executed.                                                                                                                   |
| Tailscale/public routing                    | Controlled runner fixtures cover discovery/Windows paths, login guidance and mapping ownership. A ready-but-refused Serve fallback uses relay without restarting daemon/gateway or advertising a false HTTPS route. Public Host/Origin forwarding runs on real sockets.                                                                                                                                                       |
| Electron                                    | Actual main/renderer fixture proves daemon-only launch, explicit Hub start, trusted renderer IPC, OS-encrypted storage and unchanged daemon PID. Actual asar supervisor/worker import, physical runner, crash recovery and archived Hub production runtime/migrations boot pass locally. Third-party dependencies are physical checkout links; this is not a complete electron-builder distribution.                          |
| Installed npm artifacts                     | Seven actual `npm pack` tarballs installed in an isolated tree boot the CLI, Hub migrations, gateway and bundled UI. Pair/start-Hub preserves daemon PID/socket. Third-party dependencies reuse the checkout installation; this is not a clean registry install.                                                                                                                                                              |
| Android                                     | Native Debug build and installation on an owned Pixel 8 emulator; real OS deep link redeems the combined invitation; both daemon and Hub credentials are stored and both services connect. Cold restart restores saved authority, Hub access and real Host Online status. Actual Hubs/Overview/Settings renders match the shared v11 hierarchy; selected Hub/Host controls remain bounded and scoped navigation is reachable. |
| iOS                                         | Native Debug build, ad-hoc-signed Simulator installation on an owned iPhone 17 Pro; real OS deep link reaches Overview and stores both credentials in SecureStore. Cold restart restores saved authority, Hub access and real Host Online status. Actual Hubs/Overview/Settings renders match the shared v11 hierarchy; selected Hub/Host controls remain bounded and scoped navigation is reachable.                         |
| Google handoff surfaces                     | Three managed-page tests and five Desktop callback/preload tests pass. Backend tests use signed provider fixtures and the real verification/admission code; no real Google account login was performed.                                                                                                                                                                                                                       |
| Build/package consistency                   | Scoped protocol/client/device/server/Hub/CLI/Desktop typechecks and builds, web export, additive migration checks, package dry runs and 10 CI workflow contract tests. Final App 173 tests/17 files, typecheck/lint and actual browser/relay checks pass; native source/geometry changes have direct device-render evidence above.                                                                                            |

Final actual evidence includes `full-final-v11-runtime.log` (browser controls, account,
production relay and backend lifecycle), `npm-artifacts-final-tested-assets.log`,
`electron-asar-final.log`, `asar-real-hub-final.log` and `app-tests-final-v11.log`.
Final screenshots use `final-v11-*.png`; earlier failure/pre-hydration captures are diagnostic,
not accepted results. The final empty-state footer is universal (it does not imply a connected
Host when none exists); its updated web export and desktop/narrow browser check are separate
from the unchanged full behavior/artifact gates above. Native `ios-final-overview.png`, `ios-final-settings-hosts.png` and
`android-final-settings-hosts.png` document the narrow title and complete scoped navigation.

The checked-in process entrypoints are:

```sh
npm run test:e2e:personal-serving --workspace=@clisbot/cli
npm run test:e2e:packaged-serving --workspace=@clisbot/cli
npm run test:e2e:personal-serving --workspace=@clisbot/desktop
```

The CLI fixture has opt-in real-browser and production-relay modes. The desktop command
includes the actual Electron/asar child-launch fixture. The existing CI matrix builds the
backends and runs lifecycle, archived-child and installed-artifact checks on Linux/Windows.
The Linux Electron fixture runs in an owned D-Bus session with an isolated, unlocked GNOME
Secret Service keyring; it verifies OS encryption rather than allowing `basic_text`. Two
wrapper lifecycle tests and the YAML contract checks pass locally. The local macOS run does
not claim those remote jobs or a real Linux keyring session have executed.

The user's live daemon was preserved throughout. Both protected pre-existing app files are
verified against their baseline hashes. Test lifecycle acts only on owned homes/ports,
emulator/simulator and browser contexts.

## External release gates

- Configure the official Google project/client audience and deploy the managed authentication
  page at its approved HTTPS origin, then execute real Google/Workspace login and cancellation
  on every supported client and direct/relay route. Provider-fixture tests are not real login.
- Execute the existing Windows/Linux process and Electron packaging CI jobs. Native simulator/
  emulator execution above does not establish Windows/Linux behavior or device-camera QR use.
- Validate physical-device QR camera, installed-app upgrades, production signing/notarization
  and app-store distribution. The Android Debug and ad-hoc-signed iOS Simulator builds are
  development artifacts, not a release available to end users.
- Validate real Tailscale Serve certificate/mapping and Cloudflare/public TLS deployment.
  No user's Serve mapping or public deployment was changed by the process tests.
- Publish the updated official web, native/Desktop apps and version-aligned npm packages,
  including `@clisbot/device-access`. Ordinary users must have a released supported client;
  today's public web and older installed apps are not upgraded by this source change.

Release scope remains all supported platforms. These gates distinguish missing publication
evidence from implemented source; no platform is silently deferred and no release is claimed.

## Independent security verification — 2026-10-03

An independent review reproduced and fixed live-session ciphertext replay, anonymous
Hub socket retention and the pending-handshake buffer limit. Fresh adversarial checks
covered wrong Hub/body proofs, mixed device/account sessions, durable nonce replay and
real Hub socket admission/reconnect. See the [review and limits](../../audits/2026-10-03-device-pairing-security/README.md).

The fixes require updated receiving endpoints. Legacy feature-off admission remains
a separate rollout decision; no running user service was restarted.
