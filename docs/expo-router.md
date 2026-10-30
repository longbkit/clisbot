# Expo Router

Clisbot's mobile route tree is fragile because Expo Router and React Navigation do
not fail loudly when a nested native route is mounted under the wrong layout. The
usual symptom is a white or blank native screen with no JavaScript crash.

Read this before changing `packages/app/src/app`, startup routing, remembered
workspace restore, or active workspace selection.

## Ownership

Each layout owns only the routes directly inside its directory.

- The root layout registers `h/[serverId]` and the `(tabs)` group.
- `packages/app/src/app/(tabs)/_layout.tsx` owns the peer pages: `open-project`, `chat`,
  `work`, `schedules` and `more` ([Phone tabs](#phone-tabs)).
- The root layout does not register host leaf routes such as
  `h/[serverId]/workspace/[workspaceId]`, `h/[serverId]/open-project`, or
  `h/[serverId]/index`.
- `packages/app/src/app/h/[serverId]/_layout.tsx` owns the host leaves with
  relative screen names: `index`, `workspace/[workspaceId]/index`,
  `agent/[agentId]`, `sessions`, `open-project`, `settings`,
  `plugin/[pluginId]/[surfaceId]`, and
  `plugin/[pluginId]/[contributionKind]/[contributionId]`.

Expo Router warns with `[Layout children]: No route named ...` when a layout
registers grandchildren. Treat that warning as a route-tree bug. On native, that
shape can leave a nested index route mounted without its local dynamic params and
render a blank screen.

## Navigation Context

Expo SDK 57's `Stack` and `ExpoRoot` use Expo Router's bundled navigation implementation.
Import navigation hooks, contexts, action types and reducers from the public
`expo-router/react-navigation` entry point when consuming that tree. Direct
`@react-navigation/native` hooks read a different context, so even a correctly mounted
screen can throw "Couldn't find a navigation object". A second `NavigationContainer`
or a fallback focus value would hide the mismatch and break route ownership.

Keep test mocks on the same public module as their consumers. Reducer tests must exercise
the installed Expo Router reducer, and browser journeys must assert mounted Home,
workspace and conversation content; a URL change alone does not prove rendering succeeded.

## Startup

The root mounts favicon and macOS dock-badge synchronization only on web (including Electron).
Its catalog/status subscriptions have no native output; effect-level native guards alone still
leave those subscriptions and projections active. Native tab badges and notification routing
keep their separate existing owners.

With the Home extension enabled (default), a cold `/` launch opens `/open-project`. Explicit
workspace/chat links win, and resuming from background preserves the current screen. See
[Home and Inbox](features/home-and-inbox/README.md) for tab navigation and rollback.

With `EXPO_PUBLIC_CLISBOT_HOME_V2=0`, the root `/` route chooses a host boundary. It does not jump directly into a host
leaf.

- Good: `/` -> `/h/[serverId]`
- Bad: `/` -> `/h/[serverId]/workspace/[workspaceId]`

`/h/[serverId]` is the host home route. The host index restores the last
remembered workspace for that host after the remembered selection has hydrated
and the workspace has not been proven missing. If there is no restorable
workspace, it goes to global `/open-project`.

When the workspace screen proves the remembered workspace missing (its Host is
online, its workspaces have loaded, and there is nothing to recover), it forgets
the selection, and a later visit to that stale URL does not remember it again.
Without that, every cold launch restores the dead workspace before its Host
connects, and the reader cannot get past it.

The root index picks only Hosts in the Host inventory (`useHostInventory`), the
same list the Host route renders. A saved Host the inventory hides would
otherwise land on "Host unavailable".

This restore is based on the last navigated workspace, not current connection
status. Do not redirect to another online host just because the remembered host
is still connecting or offline; the workspace screen owns that offline/loading
state.

After a workspace has rendered, a Host reconnect keeps its panes mounted and visible,
preserving cached history and unsaved editor content. The panes own their connection and
sync status as described in `timeline-sync.md`. Missing, archived, or unreachable workspaces
dispose those panes; a workspace that has never become ready does not mount them while
waiting for its Host.

This split is deliberate. The host layout must mount first so native local
dynamic params exist before any nested workspace leaf is selected.

## Error Recovery

Native Hub OAuth returns through `hub-auth/callback`, registered in the root stack.
Like `hub-google`, this route only returns to Hub account settings. WebBrowser and
the native Hub transport own the pending PKCE transaction, callback validation and
grant exchange; a landing route must never read, display or replay its credentials.
A cold callback with no pending transaction returns to the existing sign-in action.

Native Hub OAuth requests use an AbortController deadline and explicitly serialized form bodies. Hermes does not provide `AbortSignal.timeout`, and React Native fetch does not serialize a `URLSearchParams` body object. Exchange, refresh, and revoke must keep these native contracts; browser-only mocks are not sufficient validation.

Unknown links use the app's `+not-found` recovery screen with Back and Home. Do not
display the raw incoming URL (it can contain a one-time credential), or send users
to Expo's diagnostic Sitemap as recovery from a failed link.

The root error boundary lives above `ExpoRoot` in `src/root-app.tsx`. Reload
remounts the router at `/open-project`, preserving saved workspace layouts and
the remembered selection. Do not move the boundary inside the root layout:
catching a render error there unmounts the navigator, so the recovery button
cannot reliably dispatch a navigation reset. Starting recovery at `/` would
restore the same workspace and could repeat the crash.

## App-Wide Route Hops

When app-wide routes such as `/new`, `/settings`, or `/sessions` navigate back
into a host workspace, use `navigateToWorkspace()`. Do not make the caller
branch on its current route.

Pass only `serverId` and `workspaceId` for normal attention-aware navigation.
When the action names a specific tab, pass it as `target`; that explicit choice
is authoritative. Callers should not choose between separate route and tab
navigation APIs.

The root stack owns `h/[serverId]`; the host stack owns
`workspace/[workspaceId]/index`. Repeated global-route hops must `POP_TO` the
root host route and pass the nested workspace screen when a host route is
already mounted, or Expo Router can append extra hidden workspace deck entries.
The workspace navigation helper inspects the mounted navigation state to make
that decision; if no host route is mounted yet, it falls back to ordinary route
navigation. Both paths wait for the root navigation container to be ready. The
workspace navigation owner keeps the latest pending intent across ref
re-registration and applies it on the container's `ready` event; routes must not
add their own readiness retries.

Those hidden entries are not harmless: composer floating panels can measure
against the wrong deck and disappear offscreen. Follow the
[retained panel measurement rules](coding-standards.md#retained-panel-measurements)
for components that intentionally remain mounted while hidden.

Hidden host routes may keep their local params while an app-wide route is
foregrounded. Active-workspace observers must prefer the current pathname and
only use local param fallback during cold mount (`/` or empty pathname), or a
hidden workspace can overwrite the remembered workspace before Settings or
History returns.

The native workspace Deck is scoped to its actual focused leaf, rather than an app-wide active
workspace observer. Within that leaf's Host workspace branch (full or transient parent pathname),
its decoded local `route.params` own the pane identity. Expo can publish an older complete global
workspace pathname after the new native params are focused; using that global workspace ID would
remount the old pane inside the new screen. A newer native leaf's params take ownership when it
focuses. Hidden leaves, other-Host paths and global Chat/Settings/History paths remain inactive;
this rule does not change global parsing, remembered selection or web/desktop retention.

Settings root Back follows its existing navigation entry before consulting remembered workspace
selection. A saved session is a cold-link fallback, not the origin of Settings opened from Home
or Chat. On web, screen Back uses browser history when present: Back/Forward may reconstruct a
different navigator stack while the browser still holds the actual entry. Native keeps stack Back. Settings detail
Back still resolves its explicit parent; do not change peer-tab navigation or workspace
retention to repair a Settings return.

Expo Router 57.0.28 also keeps a private web-history index that can lag an external browser
Back/Forward event. `patches/expo-router+57.0.28.patch` rebases that index from the current
browser-owned entry before its existing bounds check, preventing a second pop from leaving
the first app entry. It is installed through `postinstall-patches.mjs`; remove the patch when
the installed dependency includes the equivalent fix. The actual-browser regression covers
the first-entry boundary and valid interior Back/Forward. This does not change native navigation.

Plugin settings use the distinct `settings/hosts/[serverId]/plugins/[pluginId]/[screenId]` leaf;
Back returns to that host's Plugins page.

Settings detail routes are separate siblings on purpose. Keep
`settings/[section]`, the host routes, the projects index, and project detail as
distinct route names. `router.dismissTo()` ultimately matches stack entries by
route name. A single catch-all Settings route would make project detail and the
projects index the same route; Back would update params in place and leave a
phantom detail entry underneath. The host routes also stay outside the
store-ready protected group so a cold host deep link can survive daemon startup.
Do not collapse this topology with a catch-all, `getId`, or
`dangerouslySingular` workaround.

## Phone tabs

On Navigation V2 phones, Home, Chats, Work, Schedules and More are one tab navigator: the
`(tabs)` group's layout renders `PhoneTabs` (`clisbot/home/phone-tab-navigator.tsx`), a
`TabRouter` whose view keeps every visited tab mounted and switches by visibility
([mobile panels](mobile-panels.md#phone-tabs)). The group adds no URL segment, so `/chat` and the
other tab links, notification taps and startup restore resolve as before. Desktop, tablets and the
Home V2 rollback get a plain stack from the same layout.

They replaced peer routes swapped with `router.replace`. Every switch unmounted one screen and
mounted the next, and Chats and Work also slid the animated `agent-list` panel; a switch took 2 s
or more on a production Android build.

- **Details push above the tabs.** A workspace, chat or settings page goes on the root stack over
  `(tabs)`. Back, the header Back and Android Back pop the root stack to `(tabs)`
  (`returnToPhoneTabs`), which still shows the tab the detail came from, at its scroll position.
  Never `navigate` back to a tab from a detail: the root stack pushes a second `(tabs)` and remounts
  every tab. Never `dismissTo` a route that is not in the stack either: POP_TO then replaces the
  current route, which is `(tabs)`. `navigateToHostWorkspaceRoute` pushes while the phone tabs are
  focused, before trying POP_TO: a host route left below the tabs would otherwise be popped to.
- **Expo Router nests the app's root stack** under its own `__root` route. `getRootState()` is the
  container's state, so `phone-tab-routes.ts` finds the stack holding `(tabs)` along the focused
  routes.
- **Tab entry points** go through `useNavigateHomeTab`: a switch inside the tabs, `dismissTo` from a
  detail above them, `replace` from a cold deep-linked detail with no tabs underneath
  (`resolvePhoneTabReturn`). The tab bar dispatches its switch directly on the tab navigator, so the
  target shows in the press's own commit.
- **A `(tabs)` mount keeps its navigator kind.** The root stack holds the group's navigation state,
  and swapping the layout's navigator in place hands a tab state to a stack, which crashed the root
  error boundary on a window resize. When the breakpoint changes, the layout waits until the tabs
  are focused, then replaces the `(tabs)` route on the tab it shows (`phoneTabsRemountAction`), so
  the other kind mounts fresh. Visited tabs remount once at that point.

The stack layouts keep the earlier policy: a native Home V2 peer page replaces the current one,
browser and desktop entry points keep ordinary history, and detail Back navigates to its entry
surface so the host route underneath keeps its retained workspace deck. See
[the native measurement harness](mobile-testing.md#native-switching-performance).

## Agent Targets

Notifications and agent URLs name a host and agent. Both use
`navigateToAgent()`, which reads the agent's current workspace from the store
or routes through `/h/[serverId]/agent/[agentId]`. The agent route waits for
the named host, demands its directory, and waits for workspace and layout
hydration before opening the tab. Keep the stable agent URL free of a workspace
hint. [Notifications](notifications.md) owns tap delivery and native lifecycle
constraints.

When a workspace target cannot open yet, `navigateToWorkspace()` records a
pending open in the layout model under that host and workspace key. The owning
workspace screen consumes it once after hydration. Archived-workspace recovery
reads the same pending target, so startup redirects cannot discard it and a
retained screen cannot consume another workspace's request.

Legacy `?open=` links seed this model state at the matched route boundary and
then lose the query parameter. Internal navigation does not use the query as a
handoff. Read matched route params locally; global search params let retained
workspace screens observe requests for other workspaces.

## Params

Required dynamic params belong to the matched route.

Do not paper over missing required params by reading global params in the leaf.
If `useLocalSearchParams()` misses a required param, fix layout ownership or the
startup route shape.

Use the host route context for host-owned leaves that need the host id after
`h/[serverId]/_layout.tsx` has matched. Do not make a leaf recover from an
unmatched tree by guessing from global state.

## App Directory

Keep non-route modules out of `src/app`. Expo Router treats ordinary `.ts` and
`.tsx` files there as routes, which produces `missing the required default
export` warnings and pollutes the route tree.

Put shared route policy in `src/navigation`, `src/utils`, stores, or another
non-route directory.

## Native Stack

Keep workspace identity and retention outside native-stack `getId` and
`dangerouslySingular`. Expo Router maps `dangerouslySingular` to React
Navigation `getId`, and `getId` has broken Android native-stack/Fabric by
reordering an already-mounted workspace screen.

Use `ThemedStack` from `packages/app/src/navigation/themed-stack.tsx` for every
Expo Router stack. React Navigation otherwise paints each native stack screen
with its light default background. A screen-level wrapper can hide that surface
while settled, but Android may expose it for one frame when navigation crosses
from a nested stack to its parent stack. This is especially visible when an
app-wide route such as `/new` opens from a dark workspace.

Do not read the active theme with `useUnistyles()` in a layout to build
`screenOptions`. `ThemedStack` keeps that third-party prop theme-reactive through
a small `withUnistyles` boundary without subscribing the route tree itself to
every Unistyles runtime update.

Navigators keep their identity across appearance changes. `ThemedStack` remounts
each ordinary screen's content below the native stack when appearance tokens change.
Workspace screens own retained panel lifetimes and update appearance at their
leaves through `screenOwnedAppearance` ([Explorer](explorer-sidebar.md)). A
keyed wrapper above a stack remounts the stack itself, and Android crashes when
that happens while a FragmentManager transaction is running, which settings
hydration at startup makes likely. A screen that mounts a nested navigator (the
root stack's `h/[serverId]`) is passed in `nestedNavigatorScreens` so the nested
stack owns its own screens. See [unistyles.md](unistyles.md).

## Regression Shape

Pure helper tests are useful but not enough. The failure mode here is native
route-tree state, so a real regression should launch native with seeded persisted
state:

1. Seed `clisbot:last-workspace-route-selection` with a valid
   `{ serverId, workspaceId }`.
2. Launch the native app cold.
3. Assert a real screen is visible, not the blank tree.
4. Assert no `[Layout children]` warning appears.

The pure policy tests should still enforce the boundary split:

- root startup with a saved workspace returns `/h/[serverId]`;
- host index with the same saved workspace returns
  `/h/[serverId]/workspace/[workspaceId]`;
- host index with no restorable workspace returns `/open-project`.

## Checklist

Before landing route changes:

- [ ] Did you change `packages/app/src/app`? Re-read this file.
- [ ] Did you touch remembered workspace restore? Keep root on `/h/[serverId]`.
- [ ] Did a route return to a workspace? Use `navigateToWorkspace()` and pass a
      `target` when the action names a specific tab.
- [ ] Did you add a route? Register it in the layout that directly owns it.
- [ ] Did a phone detail return to a tab? Pop to `(tabs)`; do not `navigate` there.
- [ ] Did `useLocalSearchParams()` lose a required param? Fix the route tree.
- [ ] Did native show a blank screen without a crash? Suspect route ownership
      before stores, themes, or rendering.

### Removing a Host from compact Settings

After removing a Host, dismiss its Settings detail to the existing `/settings` entry rather
than replacing the detail with a second `/settings` history entry. Root Back then returns to
the actual reader (which may now show Host unavailable) in one press. A cold detail without
that parent uses the router's existing dismiss-to fallback. Wide Settings still replaces the
removed detail with General. This reuses the Settings navigation owner; it does not redirect
the removed Host's reader or change saved workspace selection.

Host availability gates leaf content below the existing Host navigator. Keep that navigator
and its relative screen registrations mounted when its inventory entry disappears, and use
`ThemedStack.screenContentFallback` to render Host unavailable instead of the leaf. Inaccessible
workspace, agent, plugin, bot and chat content must unmount; a hidden overlay is not an access
boundary. Registering the Host again restores the ordinary leaf through its existing hydration.

Returning to an unavailable reader preserves its exact original path, including
`/h/[serverId]/workspace/[workspaceId]`. Unmounting the Host navigator can lose that nested route
and serialize `workspaceId` as a parent query parameter. A query fallback or replacement reader
URL does not satisfy this contract.
