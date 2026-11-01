# Composer picker

CURRENT — `feat/plan-in-modes`, 2026-11-01. Modelled on T3 Code's picker.

The composer bar shows two agent controls besides attach, tools, the context ring and voice:

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

When the bar is short of room (`resolveComposerControlDensity`) the effort leaves the chip
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
| Footer    | Speed levels with "Higher cost", then Mode          | Same, pinned above the safe area       |
| More      | Other provider options (Copilot Agent, ACP options) | Same                                   |

- **The rail opens on the current model's provider**, so the check is on screen; Favorites is
  one press away. A running agent is one provider's process, so its rail holds Favorites and
  that provider only.
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
- **A query searches every provider** and matches provider names too: `codex` lists every Codex
  model, `so` every model containing "so". Search matches and Favorites mix providers, so each
  of their rows names its provider under the model; two providers can sell the same label. Like
  a provider's list, matches past the first eight wait behind Show more, so a broad query over a
  large catalog never mounts hundreds of rows.
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
  (`use-reasoning-preview.ts`, `composer-picker-controls.tsx`). Touch has no hover, so the
  column follows the selected model.
- **Speed** normalizes three provider features, Claude's and OMP's `fast_mode` toggle, Codex's
  `service_tier` select and Cursor's `fast` select, into at most three levels by what each tier
  means (`speed.ts`): Standard (the default tier), Fast (`fast_mode` on, Codex `fast` or
  `priority`, Cursor `fast` on) and Ultra fast (Codex `ultrafast`). The control shows only the
  levels the current model sells, so GPT-6 Sol with only Priority shows Standard | Fast. A tier
  that is none of them, such as Codex Flex (slower and cheaper), is its own segment under the
  provider's label. Every segment writes the provider's own feature id and value, never one the
  model does not offer; a model with one tier shows no control. Fast and Ultra fast carry
  "Higher cost".
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
`mode` value and by name only when no entry carries one. Selecting Plan turns plan on and keeps
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
  plans, mode switches, ACP choices (marked `clisbotChoice`) and every card the daemon raises
  itself (marked `clisbotDaemonPermission`, such as a Connector's connect and send cards, which
  also carry `clisbotConnector`) wait for a person. A provider whose own `auto_accept` is on
  answers first.
- **Only a person turns it on.** An agent's Clisbot tools refuse `full-auto-accept` from an agent
  caller: `update_agent`, `set_agent_mode`, `send_agent_prompt`'s `sessionMode`, `create_agent`
  for a child and `update_schedule`. An agent switching it on would approve its own calls, as
  `respond_to_permission` already refuses for Connector cards.
- **Observers.** A request Full auto-accept is answering is not a wait for a person:
  `waitForAgentEvent` and finish subscriptions skip it, and it raises no attention. Every
  approval is logged at info with the agent id, request id and tool name, and recorded with the
  `full-auto-accept` actor like a person's answer. If an approval fails while the request still
  waits, the request is marked `clisbotAutoAcceptFailed` and treated as a person's again
  (attention, waiters). Requests the provider still holds after a resume are answered too.
- **It ends** when another mode is picked or the provider leaves the mode it runs on.
- **Wire.** The mode id is `full-auto-accept` (`@clisbot/protocol/full-auto-accept`), accepted
  by `set_agent_mode` and in a create config. The daemon never lists it among a provider's
  modes: the snapshot keeps `currentModeId` as the provider mode and adds `fullAutoAccept: true`,
  so an older app shows the provider's own mode and its own `auto_accept` toggle. The flag is
  persisted in the agent config and restored on resume. The app offers the mode only when
  `server_info.features.fullAutoAccept` is set (`COMPAT(fullAutoAccept)`), and then hides the
  per-provider `auto_accept` toggle.
- **A provider's own `auto_accept` shows as Full auto-accept.** Hiding the toggle does not turn
  it off: unattended creates (schedules, children of an unattended parent) and older apps still
  set it on ACP, Copilot and OpenCode sessions. While it is on, the Mode reads Full auto-accept,
  and picking any other mode also writes `auto_accept: false` (`mode-options.ts`), on a live
  agent and on a draft.
- **Authorization.** Managed Access counts it as unattended (`isUnattendedConfiguration`), so it
  needs every approval privilege, as Bypass and `toolPolicy.preapproved` do
  ([permissions](../../permissions.md#approval-leaves)). The app cannot tell in advance for a
  provider with no unattended mode (OpenCode); there the daemon refuses and the app shows the
  error.
- **The mode-cycle shortcut skips it**; it is chosen on purpose. For the same reason it is never
  remembered as a provider's default mode for the next draft: picking it does not write the
  `mode` preference, and a stored `full-auto-accept` preference resolves to the provider's
  default.

## Code

`packages/app/src/clisbot/composer-picker/`: `composer-picker-controls.tsx` (the bar),
`model-picker.tsx` (the panel), `provider-rail.tsx`, `model-list.tsx`, `model-row.tsx`,
`reasoning-column.tsx`, `speed-segment.tsx`, `more-features.tsx`, `mode-dropdown.tsx`, and the
pure modules `picker-rows.ts`, `speed.ts`, `mode-options.ts`, `model-name.ts`, `picker-keys.ts`.
`composer/agent-controls/index.tsx` feeds it the live agent's or the draft's data. Strings live
in `i18n/resources/composer-picker.ts` for every app language.

Primitives: `Combobox` (panel and Mode menu), `ComboboxTrigger` (chip), `AgentControlTrigger`
(Mode), `ComboboxItem` (rows), `ToolbarButton` (rail on desktop, row star and Create profile),
`ChipRow` + `ChipButton` (rail and efforts on a phone), `SegmentedControl` (Speed),
`StatusBadge` (Higher cost), `Switch` and `Button` (More options, Retry).

`rail-store.ts`, `use-provider-rail.ts`, `use-provider-refresh.ts`, `provider-header.tsx` and
`panel-list.tsx` hold the rail's order, width and per-provider actions.

Tests: `model-picker.browser.test.tsx`, `mode-dropdown.browser.test.tsx`, the unit tests beside
each pure module, `e2e/browser/composer-picker.spec.ts` (desktop and 390px phone, screenshots
to `.debug/composer-picker/`), and on the daemon `full-auto-accept.test.ts`,
`agent-manager-full-auto-accept.test.ts`, `agent-manager-full-auto-accept.acp.test.ts` (a real
ACP agent process) and `codex-app-server-agent.features.test.ts`.
