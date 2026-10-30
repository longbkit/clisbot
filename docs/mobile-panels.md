# Mobile panels

Compact layouts have three mutually exclusive destinations:

- `agent-list` on the left
- `agent` in the center
- `file-explorer` on the right

They are one interaction, not two independent drawers. The implementation lives in
`packages/app/src/mobile-panels/`. Navigation V2 phones never open `agent-list`: Chats and Work are
[phone tabs](#phone-tabs).

## Phone tabs

Navigation V2 phones switch Home, Chats, Work, Schedules and More the way Slack does: instantly,
with no remount. `PhoneTabs` (`clisbot/home/phone-tab-navigator.tsx`) is a `TabRouter` with its own
view, not the bottom-tabs view:

- After the first paint every unvisited tab mounts hidden, one per idle slot
  (`requestIdleCallback`, a short timer on Safari), each in a transition a press can interrupt.
  A first visit is then a visibility flip, not a mount: on 2026-10-30 a first visit to Work (about
  6,100 items, 14 Hosts) took 833–1033 ms with no change on screen. A mounted tab never unmounts.
  Each tab is a `RetainedPanel` in route order, a stable sibling order.
- The tab bar (`MobileTabBar`) dispatches the switch on the tab navigator. The press's commit
  shows and activates the target and hides the old tab; its held panes render the latest value in
  that commit. No animation, no settlement, no focus-event round trip. Panels are never detached
  or frozen. Do not defer activation (`useDeferredValue`): on 2026-10-30 a busy JS thread
  postponed the deferred render until the next input, and that input, the first row tap on the
  tab, was lost.
- A pre-mounted tab holds what it rendered at mount until its first visit, then catches up in the
  press's commit.
- Hidden tabs see an inactive `useRetainedPanelActive`. Chats and Work hold their inputs as below;
  Home holds the navigation activity (`HeldNavigationActivity`); each tab's route renders memoized
  content, so a switch re-renders the routes and not their screens.
- A tab screen never gates its content on `useIsFocused`: the retained panel already hides it, and
  a focus gate unmounts the content on every hide and rebuilds it on every show. Schedules without
  a Hub or Bots Host did that through `SchedulesScreen` (every Host's schedules, agents and
  directory demand); its phone tab renders `SchedulesScreenContent` directly.
- Chats and Work render their panes directly as the tab screen (`PhoneListTab`). Work owns a
  `SidebarModelProvider` there, because the sidebar chrome's provider does not reach routes.

Route topology, Back and deep links are in [Expo Router](expo-router.md#phone-tabs).

## Home navigation

This section is the Home V2 layout, which `EXPO_PUBLIC_CLISBOT_NAVIGATION_V2=0` restores.

The Home extension (`HOME_V2_ENABLED`) adds Home / Chat / Inbox / Automations tabs above the
existing panel model. Chat is a page, not a drawer: `/chat` selects `agent-list`, the switch has no
slide, and Chat’s visual tab bar belongs to that panel. Peer-page bars belong to the routed
content column, so preparing one behind an outgoing Chat panel cannot resize its frame. The agent-list open and close gestures, the
terminal's swipe-right and the sidebar's close button are off. If `agent-list` still settles
closed while `/chat` is focused, the route goes Home rather than leave an empty page. See [Home and Inbox](features/home-and-inbox/README.md) for the page layout,
startup, Quick starts and rollback.

For native detail admission, that same outgoing panel projects the existing navigation intent as
shared compact Back chrome and centered loading. The source list stays mounted, with its geometry
and draft/selection intact, but is excluded from touch and accessibility while covered. No second
route, transcript cache or loading state machine is created. The intent snapshot identifies each
admission even when two destinations use the same panel revision. Header, hardware and selected
Chat Back reuse the existing return branch; returning publishes immediately and late appearance
cannot close the returned list. A row that hands the admission its route dispatch has that dispatch
run in a later JS task: React Native mounts all commits of a task at its end, and React Navigation
renders a pushed screen synchronously, so dispatching in the press task held the shell until the
whole destination had rendered. Back, a newer row or a panel change before that dispatch drops it
and the admission with it; nothing left Chat, so no return is awaited. The last visible shell remains usable through the panel-hide
boundary, but an old callback cannot override a newer intent, panel generation or committed global
route. Desktop/web and peer-tab presentation are unchanged. The destination's authoritative cached
body remains owned by its existing screen/store; a shell commit alone is not usable-content or
Back-latency acceptance, and JS/render work can still delay input.

Native Chat departures (including Home/Inbox/Automations) keep the outgoing panel until the
requested focused native leaf appears. A queued newer destination or return to Chat invalidates
an older completion; peer returns retain replace semantics while detail returns preserve the Host
deck. Admission callbacks read the latest committed path without changing row callback identity
on every partial/full route commit. The owning focused workspace leaf commits its local identity
separately from the global path. Native visibility is keyed by the actual screen: params-only
re-entry may reuse an already presented view. A closing start blocks that acknowledgment; a
subsequent opening start can reverse it only if no actual disappearance occurred. Android
`react-native-screens` deduplicates `DID_APPEAR` separately from `WILL_APPEAR`, so that
reversal need not emit another appearance end. A first/unpresented screen still waits for its
actual appearance; parent, stale phase, canceled intent and changed panel generation cannot
complete the destination.

Before any of this, a native phone's deck entry shows the session shell for one JS task, so the
press's frame does not wait for the workspace screen's mount
([offline cache](features/offline/offline-cache.md#the-open-shell)). A chat route does the same.
Native compact workspace entry keeps its existing header/Back surface separate from first pane
materialization. The body waits for the existing outgoing Chat presentation boundary, then React
prepares it at deferred render priority. Losing focus before that first body commits abandons the
view preparation; it does not cancel an agent turn. Once committed, panes keep the existing
retention/draft/scroll policy across Back and reconnect. This does not defer authoritative store
updates or guarantee that an individual native Fabric commit is interruptible. Web and desktop
keep immediate materialization.

Once native compact chrome has mounted, global screens retain it inactive instead of rebuilding
it on Back. The shared overlay’s explicit presentation guard hides the actual host, input and
accessibility without collapsing retained scroll ranges; close gestures and sidebar demand are
inactive too. Cold global screens still do not mount the sidebar. Compact web and desktop keep
their existing mount policies.

## Ownership

React/Zustand owns the durable intent:

```ts
interface MobilePanelSelection {
  target: "agent-list" | "agent" | "file-explorer";
  revision: number;
}
```

Every semantic target change increments `revision`. Repeating the current target is idempotent.
Compact panel selection is not persisted; a cold start begins at `agent`.

The UI worklet owns transient motion:

- one normalized position (`-1` left, `0` center, `1` right)
- the current motion target
- the active gesture's starting revision
- the last settled target

React publishes the active panel only when the canonical target and the UI-thread position agree at
the final anchor. Retained content never observes gesture previews, progress, or an unsettled target.
The gesture hosts stay mounted. The Gesture Handler web patch keeps initially disabled hosts
from capturing paragraph pointers; that capture confines browser selection to its starting paragraph. Native worklets own overlay opacity and pointer events while
React owns settled panel activity and accessibility. Native backdrop/panel descendants stay
`auto` beneath that animated ancestor: they must not wait for the settled React publication to
receive touches after the panel is already visible. The outer presentation host still blocks
all descendants on global screens; web keeps its settled child eligibility. Keep hidden native overlays laid out: collapsing
their scroll ranges makes Android spring retained offsets back to zero during touch cancellation or
release. Native panel hosts and their dependent draggable lists
also retain identity across appearance hydration and settings changes. Do not wrap those hosts in
appearance keys; see [Unistyles appearance boundaries](unistyles.md#runtime-theme-patching-for-user-preferences).

## Why one position

Both transforms and both backdrop opacities are derived from the same normalized position. Window
width is only a projection input. Rotation changes the projection, not the panel state.

This makes these invalid states unrepresentable:

- a panel and its backdrop disagreeing
- left and right drawers both claiming to be open
- a width-sync effect resetting an active drag
- one animation context settling a transition owned by the other

Do not add another panel translate shared value, backdrop shared value, or width synchronization
effect.

## Ordering and interruption

A gesture captures the current revision when it becomes active. Per-frame updates are accepted only
while that revision still owns the gesture.

When a React command arrives during a drag, its newer revision clears gesture ownership and starts
motion toward the new target. The older gesture's remaining updates and finish callback are ignored.
Canceled gestures return to the latest canonical target. A successful gesture starts its finishing
motion immediately; the matching React command adopts that motion instead of restarting it. Position
settlement and command acceptance may arrive in either order. Activity changes after both agree on
the same target.

Manual gesture arbitration has two phases:

1. Before activation, determine whether horizontal intent may begin.
2. After activation, stop running begin checks and let the active revision own updates.

Re-running the begin gate after activation self-cancels the gesture because an active gesture is, by
definition, no longer eligible to begin.

## Integration rules

- Callers request semantic targets through `panel-store`; they never write shared values.
- Gesture behavior comes from the four explicit hooks in `mobile-panels/gestures.ts`.
- A focused interactive surface may block panel-opening gestures through
  `useBlockMobilePanelOpenGestures`. Register only while the conflicting interaction is active and
  unregister when the surface is hidden or unfocused. The blocker never disables gestures that close
  an already-open panel.
- Keep `SidebarModelProvider` outside `MobileGestureWrapper`. The provider shares sidebar derivation
  across consumers, while Gesture Handler requires the wrapper's direct child to be a native `View`
  so its injected `collapsable={false}` reaches Android/Fabric.
- Mobile sidebars render through `MobilePanelOverlay`; do not duplicate overlay lifecycle or motion
  styles in sidebar components.
- The desktop left sidebar is retained too. App chrome owns separate mounted and visible decisions:
  closing it or yielding its width marks it inactive and applies `display: none` without conditionally
  removing the sidebar tree.
- Animated panel nodes use React Native static styles plus inline theme values. Do not attach
  Unistyles-generated styles to those nodes; Unistyles and Reanimated patching the same Fabric node
  has caused native crashes.
- `FORCE_REACT_RENDER_FOR_SETTLED_ANIMATIONS` stays off in `packages/app/package.json`. It is a
  compile-time flag; changing it needs a native rebuild. With it on, Reanimated 4.3 hands settled
  animated props back to React through a collector that forgets entries older than two seconds. A JS
  stall across a panel settle loses the final position, and the next React commit reverts the overlay
  to its last synced props: a backdrop over the workspace while the store says closed. Upstream fixed
  the collector in 4.4.3, which needs React Native 0.83.
- Gesture start and progress must not update React state. The retained overlay is already mounted and
  offscreen; only the shared position and its derived native styles move during a drag.
- Hidden tabs and workspaces use `RetainedPanel`. It owns a non-collapsible native root, visibility,
  pointer events, and the active signal consumed by `useRetainedPanelActive`.
- Panels whose gesture wrapper already owns visibility use `RetainedPanelActivity` to provide the
  same active signal without adding another layout root. Persistent animations, timers, polling, and
  shared clocks must subscribe to that signal and stop when their final visible consumer leaves.
- Synchronized step animations use one wall-clock-aligned source. Register a local shared value only
  while its retained panel is active so hidden animated styles remain mounted without receiving clock
  updates. Do not give every instance its own loop or leave hidden styles subscribed to the source.
- Retention order and render order are separate concerns. LRU metadata may change on every switch;
  keyed retained roots must keep a stable sibling order. Moving large retained roots triggered Fabric
  Differ failures (`addViewAt` / `removeViewAt` view reuse) on Android.
- `useIsMobilePanelActive` follows the settled target, not the requested target. Position at the
  canonical target's anchor is the settlement signal; animation duration and completion callbacks
  do not own activity. Cancellation publishes nothing.
- Do not suspend retained native subtrees with `Suspense`/`react-freeze`. Suspension changes native
  ownership and can detach descendants. Keep the tree mounted, stabilize its subscriptions/selectors,
  and use the retained-panel active signal to stop timers, polling, and other genuine background work.
  Hidden chat content is suspended on web only, through `retained-chat-content.web.tsx`, where DOM
  nodes carry no Fabric ownership; the native file keeps the chat live.
- To stop hidden re-renders, hold the pane's inputs at its owner with `useHeldWhileInactive`
  (`hooks/use-held-while-inactive.ts`) and pass them to a memoized body. The owner still subscribes;
  the body skips every update until the panel is active, then renders once with the latest value.
  Hold the derived model, not each row. For a context read deep in the pane, wrap the pane in
  `HeldContextValue` (`components/held-context.tsx`) with a stable child element.
- Catalog-backed surfaces narrow external-store snapshots and preserve unchanged directory row
  identity through the shared aggregation owner ([architecture](architecture.md)). Reducing hidden
  derivation work does not change the native workspace/tab retention limits or visibility ownership.

## Tests

`packages/app/src/mobile-panels/model.test.ts` exercises command, drag, cancellation, interruption,
rapid-command, position-settlement, and width-projection sequences through the transition model. Add
a sequence there whenever ownership or ordering changes.

`clisbot/home/phone-tab-navigator.browser.test.tsx` runs the phone tab navigator in a real
`NavigationContainer`: tabs pre-mount hidden one idle slot at a time, no tab unmounts, the press's
commit shows and activates the target, and hidden tabs render zero times on store updates. `home-tab-navigation.test.ts` runs the root stack
reducer for detail Back and cold deep links; `e2e/browser/navigation-v2.spec.ts` checks at 390px
that switches and Back keep the same tab nodes.
