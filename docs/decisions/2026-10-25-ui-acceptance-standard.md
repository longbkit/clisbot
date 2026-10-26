# Acceptance Standard — Navigation V2 + Offline O1 (and later rounds)

- Date: 2026-10-25 · Owner request: raise the bar on visual quality, consistency, stability and performance at acceptance.
- Applies to: Navigation V2 Round 1, Offline O1, and every later round. Parent (Atlas) acceptance is blocked until every item below is PASS or has an Owner-accepted exception.
- Principle: compare against `main` baseline measured the same way, on the same device/build type. Numbers below are initial targets; record the measured baseline first and never accept a regression vs baseline without explanation.

## 1. Visual quality and consistency

Reference = the app's existing shared primitives and tokens (Unistyles theme, `components/ui/*`, existing list rows, chips, sheets, headers). No new ad-hoc styles.

| #   | Check                | Pass rule                                                                                                                                                      |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | Tokens only          | No hard-coded colors, font sizes, radii or spacings in new/changed UI; grep evidence                                                                           |
| V2  | One pattern per job  | Section header, chip row, display/filter row, list row, pin mark, badge, empty state, notice banner are each one shared component used by Home/Chats/Work/More |
| V3  | Alignment grid       | Same left inset, row height, icon size and gap across Chats, Work, Home feed, More; rail icons/labels centered and equally spaced                              |
| V4  | Typography hierarchy | Title / row title / subtitle / meta sizes consistent across sections; no truncated key labels at 320 px; long Vietnamese labels fit or wrap intentionally      |
| V5  | States               | Each list has designed empty, loading (skeleton, not spinner-on-blank), offline/stale, error and long-list states; screenshots of each                         |
| V6  | Themes and locales   | Light + dark, en + vi on every screen in the matrix                                                                                                            |
| V7  | Touch and focus      | ≥44 pt targets on mobile; visible keyboard focus and hover on desktop/web; Esc/Back behavior consistent                                                        |
| V8  | No clutter           | No duplicate controls for the same job (e.g. two target switchers, two status bars); every visible control has a clear purpose per the brief                   |

Screenshot matrix (settled state, whole screen): Home, Chats, Work, More, Tasks, Schedules, session detail, failed-row actions, Seen issues, connection notice (offline source) × {desktop 1440, 1024; phone 320, 390, 430} × {light, dark} × {en, vi}, plus iOS and Android native for phone sizes. Atlas personally reviews a selected set; the full set is archived.

## 2. Stability

| #   | Check               | Pass rule                                                                                                                                               |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | No layout shift     | Home/Chats/Work: no row moves under the reader's finger during load, reconnect, late history merge or count updates (screen recording frame comparison) |
| S2  | No route jumps      | Disconnect / reconnect / Hub unreachable / revoke during an open session: route, scroll position, draft unchanged unless access is revoked              |
| S3  | Per-source failure  | 1 of N sources unreachable: no global spinner/error; only the compact notice; counts stable                                                             |
| S4  | Flake-free          | New browser journeys pass 3 consecutive runs; native smoke passes 2 consecutive runs                                                                    |
| S5  | Back/deep links     | Hardware back, swipe back, Esc, deep links, notification taps, `/sessions` redirect land correctly                                                      |
| S6  | Data integrity      | For me / Others / All counts equal across Home, Chats, Work, badges; seen/dismissed survives restart; new failure occurrence resurfaces                 |
| S7  | Restart and upgrade | Cold start with existing user data from `main` (preferences, pins, sidebar prefs) migrates without loss; flag off restores the old layout               |

## 3. Performance

Measure with the repo's existing tooling (render profiler, `traceInstant` route traces, React DevTools profiler, Android `adb shell dumpsys gfxinfo`, Xcode Instruments / Hermes profile). Release-like builds for native numbers; dev builds are not evidence.

| #   | Metric                                                               | Initial target (record baseline first)                                                                                        |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| P1  | Cold start → Home interactive from cache (mid-range Android, iPhone) | ≤ baseline; Home content painted from cache before network                                                                    |
| P2  | Tab / rail switch Home ↔ Chats ↔ Work ↔ More                         | p95 ≤ 100 ms to first frame of the new section, no blank frame                                                                |
| P3  | Open session from list                                               | ≤ baseline; cached transcript shown first                                                                                     |
| P4  | Scroll 500-row Chats/Work list and 200-item Home feed                | ≥ 58 fps median, no frame > 50 ms (mid-range Android)                                                                         |
| P5  | Re-renders                                                           | Health/count updates from 100 synthetic Hosts do not re-render unaffected rows; profiler evidence                             |
| P6  | JS thread                                                            | No synchronous persistence/eviction/backoff work > 16 ms during navigation or scroll                                          |
| P7  | Memory                                                               | Steady-state JS heap after 10 min with 100 synthetic Hosts within +10% of baseline                                            |
| P8  | Reconnect load                                                       | 100 Hosts / 10 unreachable / 10 min: connect attempts and Hub calls within the O1 simulation figures; ≤ 4 concurrent connects |

## 4. Evidence package (required for acceptance)

1. Source SHA(s) and build type per platform.
2. Baseline vs candidate table for P1–P8 with method and device.
3. Screenshot matrix archive + Atlas-selected review set with findings.
4. S1–S7 results with recordings for S1/S2.
5. Test commands and results; unrun checks listed as unrun with reason.
6. Open findings with severity; Owner-accepted exceptions recorded explicitly.
