# Global search scope: verification

How the Host / Hub / Project scope ([README](README.md)) was checked, and how to rerun it.

## Tests

| Layer    | File                                                                  | What it proves                                                                                                                               |
| -------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit     | `packages/app/src/clisbot/search-scope/cases.test.ts`                 | Every case-table row: matching, chips, scope, empty state, view-filter ranking, reveal signal, Show in Work + Undo, restore window, flag     |
| Unit     | `packages/app/src/i18n/search-scope/search-scope.test.ts`             | en and vi define the same keys; other locales fall back to en                                                                                |
| Browser  | `packages/app/src/clisbot/search-scope/search-scope.browser.test.tsx` | The real Command Center over 100 Hosts / 2,000 sessions: Tab, Enter, Backspace, Hub row, empty state, latency                                |
| Real app | `packages/app/e2e/browser/global-search-scope.spec.ts`                | Two real daemons sharing a project, one unreachable Host, the sidebar view filter, Show in Work + Undo                                       |
| Real app | `packages/app/e2e/browser/global-search-navigation-v2.spec.ts`        | Navigation V2: the Work notice and Switch to Host, Show in Work + Undo into V2 Work, an Others item with a Hub account mocked at the network |

```bash
cd packages/app
npx vitest run --project unit src/clisbot/search-scope src/i18n/search-scope src/command-center
npx vitest run --project browser src/clisbot/search-scope/search-scope.browser.test.tsx
npx playwright test --project=browser e2e/browser/global-search-scope.spec.ts
GS_SCREENSHOTS=1 npx playwright test --project=browser e2e/browser/global-search-scope.spec.ts -g "screenshot"
```

The browser harness does not run the React Compiler; the real-app spec does. A hook-order crash
(a store method named `use`, which the compiler reads as React's `use()`) passed the harness and
failed only in the real app — see `value-store.ts`. Run the Playwright spec for any change to
hooks in this module.

## Stability

`global-search-scope.spec.ts` (6 journeys) passed three consecutive runs on 2026-10-26, each
with a fresh daemon per worker. The screenshot matrix is the seventh test, gated by
`GS_SCREENSHOTS=1`; it writes 32 shots (4 states × desktop 1440 / phone 390 × light / dark ×
en / vi) to `artifacts/global-search/`.

`global-search-navigation-v2.spec.ts` (3 journeys) passed three consecutive runs on 2026-10-26.
`GS_SCREENSHOTS=1` also writes the notice in Work at desktop 1440 and phone 390, light, en and vi
(`05-work-notice-host-*`, `06-work-notice-others-*`). The Others journey signs in to a Hub mocked
at the HTTP boundary (`signInToHub`); ownership itself is the production rule.

Upstream regression: every `command-center-*.spec.ts` plus `keyboard-shortcut-sequence.spec.ts`
(30 tests) pass with scope on; on the integration branch these plus `navigation-v2.spec.ts`,
`navigation-v2-journeys.spec.ts` and the sidebar-layout scope spec pass (48). They caught one real bug: a hidden "Show in Work" button kept in
the DOM took keyboard focus; it now mounts only while revealed.

## Latency (P2-style, typing to paint)

Method: the browser harness mounts the real Command Center with 100 Hosts (one local, 99 behind
one Hub, every tenth offline), 30 project names spread 3–8 per Host, and 2,000 sessions. For each
of six queries (`clisbot`, `sandbox-4`, `release`, `billing sandbox-1`, `may`, `deploy anyapp`) it
types one character at a time and records input event → second animation frame. One warm-up pass,
then a measured pass of 56 keystrokes. "off" is the same harness with
`EXPO_PUBLIC_CLISBOT_SEARCH_SCOPE=0` behaviour (upstream search). Vite dev build, headless
Chromium, Apple M2 Max, 2026-10-25.

| Run | Upstream p50 / p95 / max (ms) | Scoped p50 / p95 / max (ms) |
| --- | ----------------------------- | --------------------------- |
| 1   | 33.4 / 84.3 / 94.0            | 33.5 / 87.2 / 101.8         |
| 2   | 33.8 / 59.6 / 83.4            | 33.3 / 68.0 / 77.1          |
| 3   | 39.5 / 68.0 / 86.5            | 34.4 / 70.3 / 85.1          |
| 4   | 25.8 / 41.4 / 65.0            | 32.6 / 54.9 / 62.9          |

p50 sits near the two-frame wait the method includes (~26–34 ms). Scope adds 0–14 ms at p95
over upstream in the same run and stays under the 100 ms target in every run; run 4 is after the
final fixes. Not measured: native release builds (iOS / Android) and a production web bundle.

The browser test gates scoped p95 at under 1.5× the same run's upstream p95, not at 100 ms: on
shared CI runners upstream search alone measures about 100 ms at p95, so an absolute budget fails
on runner speed rather than on a regression.

What keeps it flat: the catalog (Hosts, Hubs, projects, workspace → project index) is rebuilt
only when the directory or a Host's status changes; per keystroke the work is scoring ~130 Host,
Hub and project candidates plus two `Set` lookups per item row; annotated item rows keep their
object identity, so the list's memoized rows do not re-render for unchanged rows.
