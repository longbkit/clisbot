# Composer picker and layout

Flag: `EXPO_PUBLIC_CLISBOT_COMPOSER_PICKER` (on unless `0`). It switches both the picker and the
chat layout; `0` renders the upstream composer, toolbar and model sheet.

CURRENT — `fix/home-select-model-chip`, 2026-11-01. The picker is modelled on T3 Code's; the layout on
Telegram's input with the settings row of the Claude app.

## Layout

The chat composer follows Telegram's input (Android, 2026-11) with the Claude app's settings row
under it, on every width:

```
( [☰]  Message...                  📎  ≋  (🎤) )      idle
( [☰]  Fix the flaky test             📎  (➤) )      typing: Send takes the mic's circle
  6.1 Sol Medium   🔒 Default permissions      Tools off  ◯
```

**Telegram's anatomy, and ours.**

| Telegram                                                            | Clisbot                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| One container: Menu chip, emoji, text, 📎, the mic circle           | One container: Commands chip (☰), text, 📎, realtime voice, the mic circle |
| Typing: 📎 hides, the circle becomes Send in place                  | Voice hides, 📎 stays; Send takes the circle, same place and size           |
| Menu ↔ ✕ Menu; the command list docks above the bar                 | ☰ ↔ ✕; the slash list docks on the side with more room, with a handle      |
| Rows: description left, `/command` right and muted                  | Same, arguments after it; a phone stacks `/command` over the description    |
| Expanded: back top left, the text above, the controls at the bottom | Same controls in the same places, the text grown; no undo or redo           |

**Where we differ, on purpose.**

- **Two voice modes.** Dictation is the circle; realtime voice sits beside 📎.
- **The settings row** (Model, Mode, Tools, context ring) has no Telegram counterpart; agent
  sessions need it in reach. It stays under the container, expanded too.
- **Fills.** Telegram fills the Menu chip and the mic with its accent. Here accent marks the one
  primary action on the surface (design.md §3), and sending exists only once there is something
  to send: Send is the accent circle, the idle mic a neutral one, same shape and size. The ☰ chip
  rests on `surface2` and turns `surface3` on hover and while the list is open (design.md §4:
  resting fills inside an input are `surface2`). "Commands" does not fit as a label at 320px, so
  the chip is icon-only. No emoji button.
- **Desktop** uses the same anatomy: it reads as well wide, and one rule is easier to keep.

**Rules.**

- **Commands** does what typing `/` does (`slash-trigger.ts`): an empty draft becomes `/` and the
  slash list opens with every command, filtering as you type, keyboard-navigable; while the draft
  is one command being typed the chip shows ✕ and, pressed, empties it and closes the list; in a
  draft with text it types ` /` at the caret, which lists skills, as typing it there does. With
  the flag on the autocomplete draws Telegram's rows (`command-row.tsx`) under a handle and no
  longer repeats the highlighted command in a card above the list.
- **The circle** sits inside the container's right end. It holds, in order of claim: Send once
  something is sendable (text, pasted text or an attachment), Stop while the agent runs, an
  always-shown submit such as New workspace's Create, else dictation. When Stop or Create holds
  it, dictation sits before it with attach and voice. Realtime voice keeps its overlay with mute
  and stop.
- **Typing hides voice and the mic; attach stays.** Telegram hides its paperclip too, but here a
  screenshot often joins a message after its text, and hiding 📎 left no way to add it. Attachments
  alone keep all three, so another file or a spoken message can join them.
- **A refused send in the expanded editor** shows right under the container, next to Send, not at
  the top of the screen.
- **Sizes.** The container's row is the circle plus its inset: a 40px circle in a 48px target, so
  ☰ (36px face in a 44px target), 📎, voice and one line of text share one vertical center, and
  ☰ and the circle stay on the bottom row as the text grows. The container is inset `spacing[1]`
  on both ends, so ☰ and the circle sit the same distance from its border. Glyphs are 20px.
  Mic, Send and Stop share the circle's target, so nothing moves when they swap. The container
  keeps the composer's surface, border and shadow (design.md §5); one line is a capsule, two
  lines or attachment chips the composer's `2xl` box.
- **Expand** shows from the third line, above the circle inside the container, a 44px target;
  below three lines it is hidden. It opens the same editor (`useComposerFullscreen`): the same
  layout with the container grown, so ☰, 📎, voice and the circle keep their places on its
  bottom row, the text runs the container's full width above them, and the settings row stays
  under it. Text, caret, attachments and draft stay. A round filled 44px collapse button sits
  top left; Escape and the hardware back button collapse too. The editor paints
  `surfaceComposer`; its controls sit in the fullscreen body, which reserves the keyboard's
  height on native and follows the visible viewport on the web, and the native dock adds the
  safe areas. A send error shows above the container.
- **The settings row** starts on the container's left edge, inset `spacing[2]`, so with its chips'
  own padding its first glyph sits on the Commands glyph's rail. When short of room it collapses
  in this order: the effort leaves the Model chip, Mode keeps its icon (a phone always shows the
  icon), Tools keeps its icon and count (the icon alone when off, below 400px). The ring stays.
  Accessible names keep the full labels.
- **The command list opens on the side with more room** (`command-list-placement.ts`): above a
  chat's composer at the bottom, below Home's near the top, where above it left two truncated
  rows under the header (2026-11). The room counts the settled keyboard and the anchor's lift, so
  the list stays above the keyboard; the best match sits next to the composer on either side, so
  Enter and the arrows read the same. On a phone it may take 60% of the screen and scrolls
  inside, and each row stacks: the command whole in medium weight, then its description muted on
  up to two lines. Desktop keeps the one-line row and its 220px height.
- **Panels open above the composer.** The Model panel anchors to the whole composer
  (`frame-anchor.tsx`), so it never covers the text. Mode and Tools keep their own anchors.
- The phone placeholder is "Message...": Commands already names `/commands`. The composer's
  placeholder uses the `placeholder` token (design.md §3).

One component still serves every chat surface (`MessageInput`): session and workspace chats,
Home's new session, Bot and group chats, drafts, queue edits, attachments, slash and `@`
autocomplete and voice. Surfaces that hide a control keep hiding it: a Chat without
configuration rights has no settings row, a surface without voice has no voice button. A
terminal prompt (`inputMode="terminal"`) keeps the upstream presentation unchanged.

**Why.** The upstream box spent a second line on a toolbar that mixed sending, voice, the model,
the mode, tools and the ring, so a one-line message took a three-line box, and slash commands
were only discoverable by knowing to type `/`. Clisbot blends work sessions, chats and Bot chats,
so the input should feel like a chat app first. Telegram's input solves space and the send
affordance (one obvious button that appears when there is something to send); the Claude app's
row under the reply box keeps the agent settings visible without crowding the input. The
earlier toolbar stays behind the flag for rollback.

**Known limits.** Commands opens the list through the text, so on a phone it raises the keyboard
too. Inline (` /`) lists skills only, as typing does. The list's handle is a cue, not a drag
target; ✕, Escape or deleting the `/` close it. Slash and `@` autocomplete stay off in the
expanded editor, as in upstream fullscreen: the popover anchors above the composer, which fills
the surface there. The expanded editor has no undo or redo buttons: the text input exposes no
history, and the platform's own undo (⌘Z, the keyboard's) still works. On a native tablet the
line count is not measured, so expand does not show. The Mode menu and the Tools sheet still open
from their chips and can cover the pill while open. The duplicate Mode control (bar and panel
footer) is unchanged for now. Native iOS and Android were not run for this change.

## Agent controls

The settings row shows two agent controls besides the Tools chip and the context ring:

- **Model chip** — the provider icon and a short name with the effort: `6 Astra Medium` for
  GPT-6-Astra at Medium, `Opus 5.5 High` for Claude Opus 5.5. `formatCompactModelName`
  (`packages/app/src/clisbot/composer-picker/model-name.ts`) drops the family prefix the icon
  already shows (`GPT-`, `Claude `, `Gemini `) and turns hyphens into spaces. Its accessible
  name keeps the full model name and the effort, even when the chip drops the effort:
  "Model and options: GPT-6-Astra, Medium". The e2e helpers read the model and effort from it
  (`e2e/support/helpers/composer-picker.ts`).
- **Mode dropdown** — the mode's icon and name. Each mode reads as one concept, so one icon means
  one thing on every provider: lock (asks), pencil (accepts edits), sparkles (auto), shield off
  (bypass, full access), checklist (Plan) and double check (Full auto-accept)
  (`mode-options.ts`, `mode-presentation.ts`). Known modes are named and described in the app's
  language; any other mode keeps the daemon's label.

When the row is short of room (`resolveComposerControlDensity`) the effort leaves the chip
first, then the Mode label; a phone always shows the mode as its icon.

## The panel

The chip opens one panel for every other option: a `Combobox` with custom children, so it is an
anchored popover on desktop and tablet and a bottom sheet on a phone. Picking anything leaves it
open; Escape, a click outside, or the sheet's close and drag-down close it.

| Part      | Desktop                                             | Phone                                  |
| --------- | --------------------------------------------------- | -------------------------------------- |
| Search    | The Combobox header search, focused on open         | The sheet header's search              |
| Rail      | Favorites, providers, Profiles; icons or names      | Icon and name chips in a scrolling row |
| Models    | The rail's choice, or every match for a query       | Same                                   |
| Reasoning | A column beside the list, Default marked            | A chip row under the list              |
| Footer    | Speed levels with "Higher cost", then Mode          | Speed, then a full-width Mode row      |
| More      | Other provider options (Copilot Agent, ACP options) | Same                                   |

- **The rail opens on the current model's provider**, so the check is on screen; Favorites is
  one press away. A running agent is one provider's process, so its rail holds Favorites and
  that provider only.
- **Rail size.** Collapsed, each entry is a 44px target with a 20px glyph, the count under the
  glyph while searching; expanded rows are 44px with names. Small 16px icons in 32px buttons read
  as chrome rather than as the place to pick a provider.
- **Icons or names.** The rail's bottom button shows or hides provider names. The choice is per
  device (`rail-store.ts`, key `composer-provider-rail`). Until someone chooses, a window at
  least 1200px wide opens with names, friendlier for a first look, and a narrower one with icons.
  A phone always shows icon and name chips in a row that scrolls.
- **Provider order** is per device too: Move up and Move down in the provider's options menu.
  Favorites stays first and Profiles last; a provider the Host adds later joins the end. There is
  no drag to reorder: a handful of rows does not need it, and dragging inside a popover that
  closes on outside presses fights the press handling.
- **Provider header.** Above a provider's models: its name, Refresh, and its options menu
  (Provider settings…, Refresh models, Move up, Move down), on every layout. Refresh reloads that
  provider through the same snapshot refresh as Settings, shows a spinner, ignores a second press
  while one runs, keeps the panel open and the selection, and shows an error with Retry beside
  the list. Provider settings opens the provider's settings sheet over the panel, where the
  model list and advanced options live; closing it returns to the panel.
- **Search reads like an autocomplete** (`picker-search.ts`). Text is lowercased, accents drop
  (`đ` too) and `-` `.` `_` `/` and spaces separate words. Every word of the query must match the
  model's name, id or provider, in any order, at the start of a word, as a run of words read
  without separators (`gpt6`, `opus55`) or inside a word. Rows rank exact, then prefix, then word
  prefix, then inside a word; on a tie the current provider's, then favourites, then the
  catalog's order. Results follow every keystroke, the first is highlighted so Enter picks it,
  and the matched characters are bold. A provider name matches at word prefix best: `codex` lists
  every Codex model without ranking them above a model named so.
- **While searching the rail filters.** Each entry shows its match count; a provider without one
  is dimmed and cannot be pressed. Pressing a provider or Favorites narrows the results to it and
  selects it, and "in Codex ×" beside the search field widens them again. Without narrowing the
  results are grouped under a header per provider, in rail order except that a provider with a
  better match comes first, so the first row is always the best. Profiles is not searched:
  pressing it ends the search and lists the profiles. Clearing the query returns to the plain
  rail, on the entry last pressed. Favorites, alone or narrowing, mix providers, so their rows
  name their provider. Matches past the first eight wait behind Show more, so a broad query over
  a large catalog never mounts hundreds of rows.
- **Profiles** is on the rail whenever the Host supports Agent profiles, even with none that
  apply: its list applies a profile with one press (the panel stays open), its header pencil
  opens the Host's Agent profiles settings, and with none it offers Create profile, which goes
  there too.
- **Rows**: provider icon, name, ⌘1…⌘9 (Ctrl elsewhere, hidden on touch), the favorite star and
  Create profile on hover (always shown on touch), and a check on the selected model. The arrows
  move, Enter and ⌘N pick. The panel takes these keys in the capture phase while open, so the
  app's own ⌘N shortcuts do not fire behind it, but only from the search field, a model row, a
  rail entry or nothing focused (`use-picker-keyboard.web.ts`): the footer's Mode dropdown and
  speed segments, a provider menu, Retry and the Provider settings sheet keep their own keys.
  The Combobox leaves the arrows alone when it has no options of its own, as here.
- **Favorites** are per device, for every Host (`favorites-store.ts`, AsyncStorage key
  `composer-model-favorites`). They are unrelated to the retired `favoriteModels` form
  preference, which migrated into Agent profiles.
- **Reasoning follows the selected model, and previews on desktop.** Picking a model updates the
  column and its header at once because the panel stays open. On desktop, hovering or
  keyboard-highlighting another model shows that model's efforts and short name in the column
  without changing the selection; leaving the list (the column itself keeps the preview) brings
  the selected model's back. Picking an effort while previewing selects that model with that
  effort; the effort is written once the composer reports the new model
  (`use-reasoning-preview.ts`, `composer-picker-controls.tsx`). The preview only changes the
  column's content: with the selected model showing no column there is nothing to preview, so a
  column never appears under the pointer and moves the rows. Touch has no hover, so the column
  follows the selected model.
- **Speed** normalizes three provider features, Claude's and OMP's `fast_mode` toggle, Codex's
  `service_tier` select and Cursor's `fast` select, into at most three levels by what each tier
  means (`speed.ts`): Standard (the default tier), Fast (`fast_mode` on, Codex `fast` or
  `priority`, Cursor `fast` on) and Ultra fast (Codex `ultrafast`). The control shows only the
  levels the current model sells, so GPT-6 Sol with only Priority shows Standard | Fast. A tier
  that is none of them, such as Codex Flex (slower and cheaper), is its own segment under the
  provider's label. Every segment writes the provider's own feature id and value, never one the
  model does not offer; a model with one tier shows no control. A segment carries "Higher cost"
  when `isFasterTier` (`@clisbot/protocol/speed-tier`) says so: Fast, Ultra fast and any tier
  not listed as cheap, which is also what needs `agent.fast.use`. Who may pick a dearer tier is the daemon's and the Hub's call, not the panel's
  ([permissions](../../permissions.md#channel-command-access-hub)).
- **The phone footer stacks.** Standard | Fast | Ultra fast and the Mode name collided on one
  line at 390px, so the sheet puts the segments on their own line (wrapping "Higher cost" under
  them when needed) and Mode under them as a 44px row naming "Mode" and its value (the
  `sheet` surface of `AgentControlTrigger`). Desktop keeps one line.
- **Touch targets.** In the phone sheet and on touch devices every row and control a thumb
  presses is at least 44px tall: model and profile rows, Show more, effort and provider chips,
  Mode rows and the speed segments (`use-touch-rows.ts`). They use the `touch` size of the shared
  `ComboboxItem`, `ChipButton` and `SegmentedControl`; desktop rows keep their height.
- **Mode rows show their one-line description on every row**, not only the highlighted one, so
  a row never changes height as the pointer moves (design.md §11).

## One normalization layer

Provider differences live in two places and nowhere else:

- **On the daemon**, `provider-modes.ts` runs on every mode list entering the daemon (catalog,
  session modes, `mode_changed`) and copies the manifest's icon, colour tier and `isUnattended`
  onto bare runtime modes, for built-in providers and custom providers that extend one. Codex
  once reported Full access without the no-prompt mark; Full auto-accept and Managed Access both
  read that mark.
- **In the app**, `normalizeComposerOptions` (`normalize.ts`, with `mode-options.ts` and
  `speed.ts`) turns modes, efforts and features into the Mode list, Reasoning, Speed
  and Other options. Components read only that shape.

| Provider                      | Modes, Plan, Full auto-accept runs on                   | Reasoning       | Speed                   | Other options  |
| ----------------------------- | ------------------------------------------------------- | --------------- | ----------------------- | -------------- |
| Claude                        | Plan, Always ask, Accept edits, Auto, Bypass; on Bypass | per model       | `fast_mode` (some Opus) | —              |
| Claude on Bedrock or Vertex   | as Claude without Auto                                  | per model       | —                       | —              |
| Codex                         | Plan (when offered), permissions; on Full access        | per model       | `service_tier` tiers    | —              |
| Copilot (ACP)                 | Agent, Plan, Allow all; on Allow all                    | `thought_level` | —                       | Agent select   |
| OpenCode v1/v2                | Build, Plan, runtime agents; on the current mode        | per model       | —                       | —              |
| Pi, Hoplite                   | no modes, so no Mode control                            | Pi: per model   | —                       | —              |
| Oh My Pi                      | Full access, Write approval, Always ask; on Full access | —               | `fast_mode`, running    | —              |
| Antigravity                   | Full access only; on Full access                        | —               | —                       | —              |
| Muse Code                     | Default, Ask, Strict, Full access; on Full access       | per model       | —                       | —              |
| Generic ACP, Kimi, custom ACP | the session's modes; on the current mode                | `thought_level` | —                       | config options |
| Cursor (ACP)                  | the session's modes, Plan; on the current mode          | per model       | `fast` select           | —              |
| Custom `extends: claude`      | as Claude, the app's labels and icons                   | per model       | as configured           | —              |

Every provider with modes ends with Full auto-accept. The per-provider cases are
`normalize.test.ts` (app) and `provider-modes.test.ts` (daemon). A provider whose own
`auto_accept` exists keeps it on an older Host; a newer Host hides it. A custom provider that
extends a built-in (`extends: claude`, `extends: codex`) shows the built-in's translated labels
and icons: the provider snapshot names its `baseProvider`, and `resolveModeProvider` names and
draws its modes by that id. An ACP custom provider has no built-in base and keeps the daemon's
labels.

## Plan is a mode on every provider

Codex keeps two independent settings: permissions (Default permissions, Auto-review, Full
access) and the collaboration mode (Default or Plan). The daemon presents them as one Mode list:
Plan appears when the running Codex offers a plan collaboration mode, chosen by its returned
`mode` value and by name only when no entry carries one. When a profile replaces Codex's models
the daemon lists modes without asking Codex, so Plan is left out there: the manifest marks it
`onlyWhenOffered` (`staticProviderModes` in `provider-modes.ts`). Selecting Plan turns plan on and keeps
the last permission underneath; selecting a permission turns plan off. When Codex leaves plan
mode on its own (a plan approved for implementation) the daemon reports a mode change, as Claude
does for ExitPlanMode. A session saved with `featureValues.plan_mode = true` resumes in Plan, and
an old app's `setFeature plan_mode` still works behind `COMPAT(codex-plan-mode-feature)`.

- **Managed Access** judges Plan by the permission underneath as well, because an approved plan
  returns to it: a member without every approval privilege cannot pick Plan on a Full access
  agent, nor change the configuration of one already in Plan over Full access
  (`permissionUnderPlan` in `resource-authorizer.ts`).
- **Rollback.** A record saved with `modeId: plan` and `permissionModeId` fails
  `validateCodexMode` on a daemon older than this branch (2.2.1), so such a session does not
  resume after a downgrade until its mode is changed. Moving the agent out of Plan before
  downgrading avoids it.

## Full auto-accept

The last mode on every provider that lists modes. Selecting it runs the provider's no-prompt
mode (the mode marked `isUnattended`: Claude Bypass, Codex Full access, Copilot Allow all, OMP
Full access; a provider without one keeps its current mode) and the daemon approves every tool
permission request the agent still raises. Agents sometimes ask under bypass anyway.

- **One place on the daemon.** `AgentManager` answers through the same admission path as a
  person, with the system actor `full-auto-accept`, whether or not a client is connected
  (`packages/server/src/server/agent/full-auto-accept.ts`). Requests already waiting when it is
  turned on are answered too, and an auto-answered request raises no attention.
- **Never a question.** Only `kind: "tool"` requests that offer an allow are answered. Questions,
  plans, mode switches, ACP choices (marked `clisbotChoice`), an MCP server's elicitation (Codex
  maps it to `kind: "tool"`; marked `clisbotMcpElicitation`) and every card the daemon raises
  itself (marked `clisbotDaemonPermission`, such as a Connector's connect and send cards, which
  also carry `clisbotConnector`) wait for a person. A provider whose own `auto_accept` is on
  answers first. Whether the daemon answers is one function, `isDaemonAutoAccepted`, used by the
  daemon and by every observer: it reads the `auto_accept` toggle the provider reports (the
  snapshot's `features`), which is what the provider answers from, not the stored
  `featureValues`.
- **An agent cannot ask for any unattended configuration.** When the caller is an agent,
  `create_agent`, `update_agent`, `set_agent_mode`, `send_agent_prompt`'s `sessionMode`,
  `create_schedule` and `update_schedule` refuse whatever the provider judges unattended
  (`isUnattendedConfiguration`, as Managed Access asks): Full auto-accept, Claude Bypass, Codex
  Full access, Copilot Allow all, OMP Full access and a provider's own `auto_accept`
  (`tools/agent-unattended-guard.ts`). An agent doing so would approve its own calls, as
  `respond_to_permission` already refuses for Connector cards. The request is judged, not the
  target: a child still inherits its caller's mode. A schedule an agent creates or changes must
  name a mode that asks (`create_schedule`'s `mode`); a schedule whose mode an agent clears runs
  in the provider's mode that asks. A person's paths are unchanged.
- **Observers.** A request Full auto-accept is answering is not a wait for a person:
  `waitForAgentEvent` and finish subscriptions skip it, and it raises no attention. Every
  approval is logged at info with the agent id, request id and tool name, and recorded with the
  `full-auto-accept` actor like a person's answer. If an approval fails while the request still
  waits, the request is marked `clisbotAutoAcceptFailed` and treated as a person's again: the
  agent asks for attention and the daemon raises the marked request as a new
  `permission_requested` stream event, because finish subscriptions and remote waiters skipped
  the first one and learn of a request only from a stream event. Requests the provider still
  holds after a resume are answered too.
- **It ends** when another mode is picked or the provider leaves the mode it runs on.
- **Wire.** The mode id is `full-auto-accept` (`@clisbot/protocol/full-auto-accept`), accepted
  by `set_agent_mode` and in a create config. The daemon never lists it among a provider's
  modes: the snapshot keeps `currentModeId` as the provider mode and adds `fullAutoAccept: true`,
  so an older app shows the provider's own mode and its own `auto_accept` toggle. The flag is
  persisted in the agent config and restored on resume. The app offers the mode only when
  `server_info.features.fullAutoAccept` is set (`COMPAT(fullAutoAccept)`), and then hides the
  per-provider `auto_accept` toggle.
- **A provider's own `auto_accept` shows as Full auto-accept.** Hiding the toggle does not turn
  it off: unattended creates (children of an unattended parent) and older apps still
  set it on ACP, Copilot and OpenCode sessions. While it is on, the Mode reads Full auto-accept,
  and picking any other mode also writes `auto_accept: false` (`mode-options.ts`), on a live
  agent and on a draft.
- **Authorization.** Managed Access counts it as unattended (`isUnattendedConfiguration`), so it
  needs every approval privilege, as Bypass and `toolPolicy.preapproved` do
  ([permissions](../../permissions.md#approval-leaves)). The app cannot tell in advance for a
  provider with no unattended mode (OpenCode); there the daemon refuses and the app shows the
  error.
- **The daemon's unattended marks changed Managed Access.** Normalizing runtime modes made
  Claude Bypass, Codex Full access and Copilot Allow all count as unattended where they did not
  before; [permissions](../../permissions.md#approval-leaves) lists every check this reaches.
- **Children.** A child of a Full auto-accept parent starts in its provider's no-prompt mode but
  without the Full auto-accept flag, so its requests that still ask wait for a person.
- **The mode-cycle shortcut skips it**; it is chosen on purpose. For the same reason it is never
  remembered as a provider's default mode for the next draft: picking it does not write the
  `mode` preference, and a stored `full-auto-accept` preference resolves to the provider's
  default.

## Code

`packages/app/src/clisbot/composer-layout/`: `chat-composer-presentation.tsx` (the container,
its circle, the settings row and the expanded editor in one tree, so the editor never
remounts), `layout-styles.ts`, `commands-button.tsx`, `command-row.tsx`, `slash-trigger.ts`,
`input-facts.ts`, `settings-row.tsx`, `frame-anchor.tsx`, `geometry.ts`,
`command-list-placement.ts` and `feature.ts`. The upstream `AutocompletePopover`,
`Autocomplete` and `useAgentAutocomplete` take the side the list opens on
(`optionsPosition`); with the flag off it is always above.
`composer/input/input.tsx` builds the same pieces as before and hands them to `ChatComposerPresentation` instead of the upstream toolbar while the flag is on and
the composer is a chat one; `composer/input/presentation.tsx` shares its fullscreen chrome
(`useComposerFullscreenChrome`) with it.

`packages/app/src/clisbot/composer-picker/`: `composer-picker-controls.tsx` (the bar),
`model-picker.tsx` (the panel), `provider-rail.tsx`, `model-list.tsx`, `model-row.tsx`,
`reasoning-column.tsx`, `speed-segment.tsx`, `more-features.tsx`, `mode-dropdown.tsx`,
`highlighted-label.tsx`, and the pure modules `picker-search.ts`, `picker-rows.ts`, `speed.ts`,
`mode-options.ts`, `model-name.ts`, `picker-keys.ts`.
`composer/agent-controls/index.tsx` stays the upstream file, model sheet and toolbar included,
and feeds the live agent's or the draft's data to `picker-agent-controls.tsx` in their place
while the picker is on. `feature.ts` holds the switch: `EXPO_PUBLIC_CLISBOT_COMPOSER_PICKER=0`
renders the upstream toolbar, its mode control and model sheet again, without Full auto-accept
in the Mode list. The flag is the app's only: the daemon keeps offering Full auto-accept to
newer apps, its no-prompt marks, Managed Access checks and agent-tool refusals whatever an app
renders. Strings live
in `i18n/resources/composer-picker.ts` and `composer-layout.ts` for every app language. The
upstream Speed control's spec (`e2e/browser/codex-speed.spec.ts`) runs only with the flag off:
`EXPO_PUBLIC_CLISBOT_COMPOSER_PICKER=0 npx playwright test e2e/browser/codex-speed.spec.ts`.

Layout primitives: `chatComposerActions` (`geometry.ts`, the inner targets and the circle, on
top of `composerActionGeometry`'s faces and fills for Send, Stop and recording) with `Tooltip`,
`DropdownMenu` (attach), `Autocomplete`/`AutocompletePopover` (the command list),
`AgentControlTrigger` (Mode, Tools; `sheet` surface for the phone footer's Mode), the fullscreen
chrome's ghost `Button` (expand, collapse) and the composer surface tokens (`surfaceComposer`,
`borderComposer`, `shadow.composer`).

Picker primitives: `Combobox` (panel and Mode menu), `ComboboxTrigger` (chip), `AgentControlTrigger`
(Mode), `ComboboxItem` (rows, `labelContent` for the bold matches), `ToolbarButton` (rail on
desktop, row star and Create profile), `ChipRow` + `ChipButton` (rail and efforts on a phone,
the "in Codex ×" chip with its `trailing` slot, dimmed entries with `disabled`),
`SegmentedControl` (Speed),
`StatusBadge` (Higher cost), `Switch` and `Button` (More options, Retry).

`rail-store.ts`, `use-provider-rail.ts`, `use-provider-refresh.ts`, `provider-header.tsx` and
`panel-list.tsx` hold the rail's order, width and per-provider actions.

Tests: `chat-composer-presentation.browser.test.tsx`, `command-list.browser.test.tsx`,
`command-list-placement.test.ts` and `slash-trigger.test.ts` for the layout (the Home phone list
in `composer-layout.spec.ts`; screenshots to `.debug/composer-picker-search/`),
`picker-search.test.ts` for search and ranking, `e2e/browser/composer-layout.spec.ts` (desktop 1280,
phone 390 and 320, light and dark, expand at three lines with the caret kept; screenshots to
`.debug/composer-layout/`), `composer-control-density.spec.ts` (targets and faces),
`model-picker.browser.test.tsx`, `mode-dropdown.browser.test.tsx`, the unit tests beside
each pure module, `e2e/browser/composer-picker.spec.ts` (desktop and 390px phone, screenshots
to `.debug/composer-picker/`), and on the daemon `full-auto-accept.test.ts`,
`agent-manager-full-auto-accept.test.ts`, `agent-manager-full-auto-accept.acp.test.ts` (a real
ACP agent process) and `codex-app-server-agent.features.test.ts`.

## Release notes

- **Managed Access now reaches Bots and sessions in Codex Full access, Claude Bypass and Copilot
  Allow all.** The daemon marks those modes unattended, so a member without every approval
  privilege can no longer change the configuration of such a session, resume it
  (`resume_agent_request`) or deliver Chat messages to a Bot whose session runs in one. Owners
  who relied on restricted members driving those Bots must re-grant every `approval.*` privilege
  or move the Bots to a mode that asks
  ([permissions](../../permissions.md#approval-leaves)).
- **A schedule with no mode now asks for approval.** On 2.2.1 a schedule without a mode ran
  Claude in Bypass, Codex in Full access, Copilot in Allow all and OMP in Full access, and ACP,
  Copilot and OpenCode runs turned their own `auto_accept` on. Now every provider's run starts in
  its mode that asks (OMP: Write approval) with `auto_accept` off, and its approval requests reach
  the app like any agent's. To keep a schedule running without prompts, pick Full access, Bypass,
  Allow all or Full auto-accept on it.
- **A new schedule names its mode.** `clisbot schedule create` now needs `--mode` when the
  provider lists modes; without it the command fails and lists them, marking the default that
  asks and those that run without asking. Scripts that created schedules without `--mode` must add
  it. The app's schedule form preselects the mode that asks by its name and will not save
  without a mode. A 2.2.1 app or CLI can still create one without a mode; the daemon stores the
  mode that asks ([permissions](../../permissions.md#approval-leaves)).
- **Channel commands gate every faster tier**, not only `fast_mode`: a Codex `service_tier`
  other than default, standard, flex or auto, and Cursor `fast`, now need `agent.fast.use`.
