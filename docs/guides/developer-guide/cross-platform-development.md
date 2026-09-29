# Cross-platform development

The Expo app runs on web, iOS, Android, and desktop. Treat a new static import as
startup behavior on every platform: JavaScript evaluates its dependency tree
before running the importing module's body. Hiding a component behind a setting
or conditional render does not prevent its imports from loading.

Before adding an app import:

1. Follow its runtime imports, including re-exports, to check for browser,
   Node, or native-only APIs used at module scope. Use `import type` when only a
   type is needed.
2. Keep heavy or platform-specific modules behind a platform file or a load
   boundary that runs when the feature is used. Check when required polyfills
   run relative to that boundary.
3. For a changed startup import graph, cold-launch a native build and inspect
   its runtime logs. Web builds and typecheck cannot establish native startup
   behavior.

## Android startup failure from a Fusion sidebar import (2026-09-29)

The Fusion session sidebar statically imported `WorkspaceTabIcon` from
[`workspace-tab-presentation.tsx`](../../../packages/app/src/screens/workspace/workspace-tab-presentation.tsx).
That module imports the panel registry, which imports the native terminal and
`@xterm/headless`. Xterm reads `navigator.userAgent` at module evaluation;
Android did not yet have that value, so the app crashed on launch with
`Cannot read property 'includes' of undefined`. The existing
[`polyfillNavigator()`](../../../packages/app/src/polyfills/navigator.ts) call
in the root layout runs only after the layout's static imports have loaded.
The upstream app did not have this early sidebar import path.

The Fusion sidebar now keeps the presentation type as `import type` and loads
the icon module when a session icon renders in
[`session-list.tsx`](../../../packages/app/src/clisbot/workspace-sessions/session-list.tsx).
The APK without an entrypoint polyfill workaround built and cold-launched twice
on an Android 14 Pixel 8 emulator. The first session icon render after pairing
has not yet been exercised on a physical device.
