# Lane report — ui_route_evidence (agent-session-storage)

> Historical record of the 2026-09-12 campaign. Current state: [implementation.md](../implementation.md).

**Lane:** `ui_route_evidence` (app / timeline / rendered validation).
**Owning rows:** AC2, AC4 (app side), AC5, AC6 (app side), W1, W4, W5 (rendered), W6 (rendered).
**Supporting:** AC3 (no-metadata still reads, app side), AC8 (rendered download), AC9 (rendered official/mixed-host).
**Date started:** 2026-09-12 (UTC).

## Environment checks (proving evidence for blockers)

Recorded 2026-09-12 03:32 UTC to `/tmp/env-checks.log`:

| Check                                                                   | Result                                                                                                                       | Consequence                                                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `which adb`                                                             | not found                                                                                                                    | **native rendering BLOCKED** — no Android device/emulator tooling                               |
| `which Xvfb`, `which xvfb-run`, `ls /usr/bin \| grep -i xvfb`           | none                                                                                                                         | no headless X display for Electron desktop                                                      |
| `which asdf`                                                            | not found                                                                                                                    | **relay BLOCKED** — no Elixir toolchain for a local relay                                       |
| `ls -d /home/node/projects/paseo-relay`                                 | absent; `PASEO_RELAY_CHECKOUT` unset                                                                                         | **relay BLOCKED** — no relay checkout to run `local-elixir-relay.ts` against                    |
| root `node_modules/.bin/electron` present, `DISPLAY` unset, no Xvfb     | Electron binary exists but no display server                                                                                 | **desktop (Electron) BLOCKED** — cannot launch a desktop window to capture the real shell       |
| `packages/app/dist` (production web export, built 2026-09-12 03:00 UTC) | fresh — `find dist -newer dist/index.html -name '*.js'` returns only same-build artifacts; 0 src files newer than the export | usable as the **real styled workspace shell** via `E2E_STATIC_APP_DIR` + `startStaticAppServer` |
| main daemon `~/.paseo` / port 6767                                      | untouched; e2e fixtures spawn isolated daemons on random ports                                                               | isolation boundary respected                                                                    |

**Production boundary statement:** the rendered shell in this run is the **production web export**
(`expo export --platform web` output at `packages/app/dist`, served by the repo's
`e2e/support/static-app-server.ts` and driven by headless Chromium). The Metro dev-server route
failed in prior runs (cold warmup timeout, RAM interruption — see implementation.md) and is not
re-attempted here; the static export is the repo-supported "production browser" path. Native
(adb/Xvfb), relay (no Elixir toolchain/checkout), and desktop/Electron (no display server) are
BLOCKED with the checks above; nothing in this lane claims those boundaries.

## Commands run this lane (append per run)

1. `packages/app$ E2E_STATIC_APP_DIR="$PWD/dist" PASEO_AGENT_SESSION_STORAGE=1 node_modules/.bin/playwright test --project=browser e2e/browser/session-profile.ui-contract.spec.ts` → `/tmp/ui-ac2-run1.log` (1 passed, 1.9m)
2. `packages/app$ E2E_STATIC_APP_DIR="$PWD/dist" PASEO_AGENT_SESSION_STORAGE=1 node_modules/.bin/playwright test --project=browser e2e/browser/sidebar-session-metadata.ui-contract.spec.ts` → `/tmp/ui-sidebar-meta-run1.log` (2 passed, 2 failed — failures were spec bugs, attributed below)
3. `packages/app$ ... playwright test --project=browser e2e/browser/sidebar-session-metadata.ui-contract.spec.ts -g "narrows the list|matches OR-within"` → `/tmp/ui-sidebar-meta-run3.log` (2 passed — W5/W6 after the spec fixes)
4. `packages/app$ ... playwright test --project=browser e2e/browser/sidebar-session-metadata.ui-contract.spec.ts` → `/tmp/ui-sidebar-meta-run5.log` (**4 passed** — canonical, no concurrent load; the one heavy run)

## New artifacts (this run)

- screenshots → `/tmp/ui-shots/`
  - `ac2-workspace-profile.png`, `ac2-workspace-chat-restored.png` (AC2 real styled shell)
  - `w1-metadata-row-all-columns.png`, `w1-show-hide-remembered-after-reload.png` (W1)
  - `w4-compact-time-and-hover-full-date.png` (W4)
  - `w5-user-filter-multi-actor.png` (W5)
  - `w6-zero-result-empty-state.png` (W6 — the "No workspaces match / Clear filters" card),
    `w6-zero-result-filter-clear-still-reachable.png`, `w6-channel-filter-active.png` (W6)
  - `probe-channel-menu.png` (transient-clip attribution probe; throwaway)
- run logs → `/tmp/ui-*.log`

## Failure attribution (run 1: W5 + W6)

Both failures in `/tmp/ui-sidebar-meta-run1.log` were **spec bugs, not app defects**:

- **W5 (user-filter):** the helper baked `expect(getByText("Clear filter")).toHaveCount(0)` into
  _every_ open of the User subpage. That is only true on the _first_ open; after a filter is
  applied the page correctly shows "Clear filter", so the stale pre-check failed on the 3rd open.
  Fixed: the pre-check now runs only on the first open.
- **W6 (channel-filter):** clicking the bottom-most SubTrigger (`sidebar-display-channel-filter`)
  reported "element is outside of the viewport" for 300s. Root cause: the display menu here is the
  _tall_ variant (the `PASEO_AGENT_SESSION_STORAGE=1` env turns on the User/Channel rows that the
  short menus in other specs don't have). Its bottom row is transiently clipped by the
  overflow-hidden content box for the first ~150ms (the 150ms entrance keyframe + the
  `useReleaseFixedMenuHeight` fixed-height snapshot release in
  `packages/app/src/components/ui/menu/menu-overlay.tsx`). A focused geometry probe
  (`probe-channel-menu.spec.ts`, since deleted) confirmed at a settled state the menu fits the
  viewport (content bottom 349 < 800, overflow hidden but no overflow) and the Channel row is
  fully clickable (`PROBE_CLICK ok`). A real user only clicks after the menu is visibly open, so
  this is a **test-timing issue, not a UI defect**. Fixed: an `openSub` helper that opens the
  subtrigger only after the open surface settles (polls until `scrollHeight === clientHeight`),
  applied to both the root SubTriggers and the pushed Show flyout.
- A second-order W6 bug surfaced after the timing fix: `getByText("Clear filter")`
  substring-matched **both** the singular menu item "Clear filter" and the plural "Clear filters"
  button on the zero-result empty-state card. Fixed with `{ exact: true }`.
- **Run 4 W1 flake (corrected):** run 4's test 1 failed on the same transient bottom-row clip as
  W6 — its three opens still used the shared no-settle `openSidebarDisplayPage`, while tests
  3/4 already used the settling `openSub`. The `openSub` fix to test 1 landed _after_ run 4
  (spec mtime 06:42 > run 4 finish 06:35); run 5 (all four tests on `openSub`, no concurrent
  heavy process in the window — confirmed by `pgrep`) passed 4/4, confirming `openSub` is the
  deterministic fix rather than load interference.

## Status per AC/W

### AC2 — profile in tab (owned)

- **Boundary (goal-matrix §A/AC2):** actual workspace route (real shell, spacing, avatar layout,
  profile-tab integration); keyboard/touch/native navigation; draft + reading-position
  preservation on tab close/restore; native behavior.
- **Existing evidence:** isolated browser harness, 4 interaction/field tests (unstyled).
- **This run:** `packages/app/e2e/browser/session-profile.ui-contract.spec.ts` against the
  production static export with the isolated daemon + `PASEO_AGENT_SESSION_STORAGE=1`
  (WS frame injection adds the `sender` SessionActor exactly as a capable daemon would).
  30-turn mock timeline; hover→open read-only profile tab, re-click reopens, no cross-Hub
  confusion (single actor), no-link tolerated (single host), draft + reading-position
  preserved on tab close/restore, tab survives reload.
- **Status:** Met-at-boundary for the _web workspace-route rendering_ sub-boundary (hover→profile
  tab, re-click reopens, no cross-Hub confusion, no-link tolerated, draft + reading-position
  preserved on tab close/restore, tab survives reload). 1 passed, 1.9m;
  `/tmp/ui-shots/ac2-workspace-profile.png` + `ac2-workspace-chat-restored.png`.
- Whole-matrix boundary (coordinator adjudication): the "Must be true" list also includes
  **"Touch + keyboard also open it (no hover dependency)"** — an open, _non-environmental_
  sub-item (the trigger is a hover-coupled `TooltipTrigger`; the profile trigger is not currently
  keyboard-focusable in the web build, so a Tab→Enter open cannot honestly be proven without a
  code change that would be out-of-layer). Native is BLOCKED (no adb/Xvfb), relay is BLOCKED.
  Overall row stays **Partial** pending the keyboard/touch-open sub-item.

### AC4 — app side (page/rebuild/import UI states)

- **Boundary:** app-side page/rebuild/import UI state; "index needs rebuild" / "old-unsaved
  history" clear states, never "finished loading".
- **What renders (verified in `agent-panel.tsx` + `use-agent-screen-state-machine.ts`):**
  - boot → `agent-loading` (LoadingSpinner) — a clear "still loading" state, NOT "finished loading".
  - catch-up sync refused → `agent-timeline-sync-error` + `agent-timeline-sync-retry` ("Couldn't refresh agent history." + Retry).
  - authoritative first-load error → `agent-load-error` + `agent-load-error-retry`.
  - reconnecting → "Reconnecting" state (agent-panel).
    These are the app's pending/failure clear states, all "clear", none "finished loading". Covered by `agent-timeline-sync-retry.spec.ts`.
- **LOAD-BEARING GAP (reported, not fixed):** the app's `normalizeWorkspaceDescriptor`
  (`packages/app/src/stores/session-store.ts:135`) copies `createdBy/createdAt/lastInteractionBy/
lastInteractionAt/participantActors/channels` from the wire descriptor but **drops
  `authorshipStatus` (and `lastMessageBy`)**. Consequence: the metadata row's
  "Metadata pending / Loading metadata / Metadata unavailable" labels
  (`workspace-metadata-row.tsx`) and the `sidebar-metadata-notice` recovery notice are
  **unreachable in the rendered app** — they key off `workspace.authorshipStatus`, which is always
  `undefined` after normalization. So a "index needs rebuild / metadata still loading" clear-state
  **has no reachable UI surface** in the shipped renderer. This is a genuine app-side gap, not a
  harness limitation; filed as a finding (see out-of-layer / open questions), not claimed Met.
- **Status:** Partial. The generic pending/failure clear states render (agent-loading / sync-error /
  load-error, never "finished loading"), but the session-metadata "pending/rebuild" clear state
  specifically is unreachable due to the `authorshipStatus` drop.
- Missing: any metadata-pending surface that the contract requires as distinct from the generic
  agent loading state.

### AC5 — scroll/prefetch/anchor (owned)

- **Boundary:** production route scrolling, viewport anchoring, directional prefetch stop
  (session change / history end / cache budget); paged/complete contract incl. short pages.
- **Existing evidence:** app directional-prefetch + deferred-refresh unit tests; 11
  history/prefetch tests.
- **Status:** _pending run_
- Missing: native/relay behavior (BLOCKED: no adb/Xvfb/relay checkout).

### AC6 — app steady-state RAM (owned)

- **Boundary:** whole-process steady state under a fixed retained-page budget; repeated
  open/close/scroll must reach steady RAM; app measured separately from the provider/daemon.
- **Status:** _pending run_ (open/close/scroll loop on the production export, sampling the
  Chromium app process RSS and the isolated-daemon RSS separately)
- Missing: long-run duration vs the published load; daemon-side steady state is
  `storage_plan_rebuild`'s owned boundary.

### W1 — Show/Hide (owned)

- **Boundary:** actual styled shell / no-gap; remembered after app relaunch.
- **This run (run 5, clean):** toggling `createdUser/updatedUser/createdTime/updatedTime` in the
  display-preferences "Show" page adds/removes the metadata-row columns in the real styled shell;
  hiding `createdUser` drops Alice from the row with **no leading gap** (the row filters nulls
  before joining — remaining items stay contiguous); after a cold `page.reload()` the toggle state
  is remembered (createdUser hidden, rest shown) because it persists in app settings.
- **Status:** Met-at-boundary (web). `/tmp/ui-shots/w1-metadata-row-all-columns.png`,
  `w1-show-hide-remembered-after-reload.png`.
- Missing: native rendering (BLOCKED: no adb/Xvfb).

### W4 — compact time (owned)

- **Boundary:** real rendered platform validation — compact labels + shared clock +
  hover full date + timezone; self-update without per-row timers.
- **This run (run 5, clean):** created/updated time columns render compact labels matching
  `describeCompactTimeAgo` exactly (e.g. "3d", "45m"); hovering the created-time label shows the
  full date-time with a named timezone (asserted via a locale-robust regex, not an exact
  locale string); the >7d static-tier row (meta-c) renders the real "Mon D" date.
- **Status:** Met-at-boundary (web). `/tmp/ui-shots/w4-compact-time-and-hover-full-date.png`.
- Self-update/shared clock: the renderer uses the tiered `relative-time-ticker` (no per-row
  timers; `activeRelativeTimeTickerCount()` seam) — the rendered proof here is the label content
  - hover full date/TZ; the clock-tick behavior itself is covered by the unit tests on
    `relative-time-ticker.ts` / `describeCompactTimeAgo`.
- Missing: native rendering (BLOCKED).

### W5 — user filter rendered (supporting render; semantics owned by gate1_auth_compat)

- **Boundary:** actual multi-actor browser rendering of the user filter.
- **This run (run 5, clean):** the User subpage lists every creator + participant across
  workspaces (Alice/Bob/Carol as `displayName · id · hub / org / connection` menuitems);
  filtering to Alice narrows the list to meta-a **where Alice is a historical participant even
  though Bob took the last turn** ("A is still findable after B takes over"); the active-filter
  indicator shows on the User row; OR-within (filter Bob → meta-a + meta-b); clearing restores
  all.
- **Status:** Met-at-boundary for the _rendered multi-actor user filter_ sub-boundary (web).
  `/tmp/ui-shots/w5-user-filter-multi-actor.png`.
- Whole-matrix boundary (coordinator adjudication): the row also lists "full lifecycle
  recomputation," which is storage-owned; the storage lane's report is silent on it, so that
  sub-item is open (not environmental). Lane's rendered sub-boundary is Met; overall row stays
  Partial pending the storage sub-item. Semantics (who is admitted as an actor / host authority)
  are gate1_auth_compat's owned boundary.

### W6 — channel filter rendered (owned control; semantics gate1_auth_compat)

- **Boundary:** rendered offline / mixed-host / zero-result controls; active indicator;
  clear-filter with zero results; no auto-clear on host offline.
- **This run (run 5, clean):** the Channel subpage lists channels (`displayName · hub / org /
connection`); filtering "Random" shows meta-b + meta-c (OR-within); the active indicator shows
  on the Channel row; **AND-across** (channel Random + user Alice, applied across two menu passes)
  matches nothing → the list body swaps to the **zero-result empty-state card**
  (`sidebar-filter-empty-state`: "No workspaces match / Clear filters") while the display menu
  trigger stays reachable, and the menu's singular "Clear filter" item also clears the specific
  filter; clearing each filter in turn restores the rows.
- **Status:** Met-at-boundary (web). `/tmp/ui-shots/w6-zero-result-empty-state.png`,
  `w6-zero-result-filter-clear-still-reachable.png`, `w6-channel-filter-active.png`.
  Note: the zero-result card renders for metadata filters because the sibling lane's
  `sidebar-workspace-list.tsx` change extends `sidebarFilterEmpty` to user/channel filters
  (verified present in the 03:00 dist bundle).
- Whole-matrix boundary (coordinator adjudication): the row also requires **rendered offline /
  mixed-host** (needs a second host — this single-isolated-daemon harness cannot produce one) and
  **no auto-clear on host offline** (a state-behavior, not proven here). Both are open, so the
  overall row stays Partial; the zero-result / active-indicator / clear-at-zero sub-boundary is
  Met-at-boundary. Semantics are gate1_auth_compat's.

### AC3 — no-metadata still reads (supporting, app side)

- **Boundary:** app meeting a no-metadata host can still chat/read; old display, no fake sender.
- **This run (run 5, clean):** the `meta-none` workspace (no authorship stamped on the wire)
  renders **no** author column, **no** "Metadata pending" placeholder, and no fake sender —
  missing data drops the whole metadata line rather than leaving a gap.
- **Status:** Met-at-boundary for the rendered no-metadata display (web). The chat/read behavior
  against a no-metadata _host_ (a second, non-capable daemon) needs a second host, which this
  single-isolated-daemon harness does not provide — the app-side rendering is proven.

### AC8 — rendered download (supporting)

- **Status:** _not proven on this lane._ The timeline download affordance is not part of the
  metadata Show/Hide / filter / compact-time surface this lane drives; proving it would require a
  separate timeline-render pass that is outside the remaining owned work here. Recorded as a
  gap, not claimed.

### AC9 — rendered official/mixed-host (supporting)

- **Boundary:** mixed-host rendered list (one host with metadata, one without).
- **This run (run 5, clean):** the single-host mixed state is proven — one workspace **with**
  stamped authorship (meta-a) and one **without** (meta-none) render side-by-side in the same
  sidebar; the no-metadata one shows no author/time columns while the metadata one does.
- **Status:** Met-at-boundary for the single-host mixed-metadata list (web). A true _mixed-host_
  list (two distinct daemons, one capable, one not) needs a second host — not available in this
  single-isolated-daemon harness.

## Out-of-layer changes filed

_none yet_ (app/e2e harness changes would be recorded in
[out-of-layer-changes.md](../out-of-layer-changes.md) before landing).

## Open questions for the coordinator

- AC4's "index needs rebuild / old-unsaved history" clear states: confirm whether the
  contract requires **new** app UI or whether existing status surfaces (metadata-row
  pending states, older-history spinner, ViewedTimelineStatus) satisfy the "clear state,
  not finished-loading" bar.
- Q4 (relay/native proof): this lane records the documented blocker; confirm a documented
  blocker is acceptable for AC5/AC2 native boundaries.
