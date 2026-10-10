# Home, Inbox and Quick starts

CURRENT — implementation in `feat/multi-hub-hosts`, 2026-10-10.

## Navigation and scope

The sidebar reads identity, then navigation. The top row is one button: the Clisbot mark, then
where you are (the signed-in organization, else the selected Hub's name, else Clisbot), then the
account avatar, Sign in, or Hub unavailable in the warning colour; it opens the Hub account page
(Hubs settings when no Hub is set up). A Personal Hub keeps its own row. Home is the first
navigation row, above New workspace and Inbox, with the same active fill; an earlier split of the
top row into "logo + Home" and "Hub" put a destination in the brand slot and left a bare "Hub"
label floating mid-row. A cold launch at `/`
opens `/open-project`; an explicit workspace/chat deep link wins. Background/resume does
not reset navigation. The compact shell has Home, Chat, Inbox and Automations tabs.
Chat opens the existing sidebar. Conversation detail hides tabs and provides Back to its
entry surface. Settings and the aggregate Automations screen (`/schedules`) are unchanged.

Home and New workspace share the existing creation composer, including Host, provider/model,
effort, permission mode, attachments and launch options. Home adds Needs you, Active and
Recent below; New workspace does not. Each group title is the way into Inbox (title, count,
chevron); there is no separate Open Inbox button. Recent groups by local Today, Yesterday and date.
Home opens with the Hosts strip (`clisbot/home/hosts-strip*.ts(x)`), a status line rather than a
card: `Hosts · n of m online`, then this computer, up to three Hosts you used most recently (by
agent activity) or added yourself, and one entry per shared Hub (`online/total`, Sign in,
Unreachable); a personal Hub's Hosts are listed by name instead. A shared Hub's other Hosts stay
inside its entry, so a company Hub never becomes a long list. Connect offers Connect a computer,
Add a Hub and Troubleshoot. Problems the user can act on (a Host they use that is down, a Hub to
sign in to or reach) collapse into one "connections need attention" line whose sheet gives each
one action. The runtime reports an unreachable Host as connecting forever, so the strip calls a
connection that errored or stayed connecting past 15 seconds "Can't connect". A Host is drawn the
same way everywhere it is named (`HostMark` in `components/host-status-dot.tsx`): this computer or a
server glyph with the status dot on its corner, in the strip, the Host trigger and the Host picker.

The context row leads with Host (when there are several), then the destination.
Under the composer, one trigger shows the ready agents' icons and `n/44+ agents ready`, then a
chevron; it opens Status & Setup, whose name is in the tooltip and accessibility label only. Import session is a quiet label at the other end of that line, not a header button: it is rare on Home and New workspace. Inbox keeps it in its header. The
`44+` is deliberate: it shows how many agents Clisbot supports. With none ready it reads
`· Set up` in the warning colour; Connecting… and Host offline replace it while the Host is away.

Where to chat is one switcher on the composer's context row (`clisbot/home/start-switcher.tsx`):
Quick chat is a segment, so it stays one tap; Project and Bot are menu triggers drawn as segments
that name the current choice and open the picker with their group first. The separate destination
chip is gone. On a phone the switcher sits in the dock above the composer and only the chosen
segment shows its chevron, so the three fit 360pt. Projects never lists a Bot's home or the
private Quick chat folder: both are daemon Projects, but each has its own entry. Without a choice
on this screen, the remembered project decides the mode: a Bot's home reopens that Bot through the
same selection a pick makes, so the Bot's own agent settings load; the Quick chat folder reopens
Quick chat. Project with no ordinary project chosen reads Choose project.
The picker lists every online Host's projects and Bots, the selected Host's first; each project
row reads name, then Host · short path, a Bot row name and Host. Search runs across all of them.
Picking an entry on another Host switches the Host first and selects the entry once that Host's
own list has it (`clisbot/home/use-cross-host-picker.ts`), so the composer loads that Host's agents.
A Host with no ordinary project opens on Quick chat, but only after its workspaces loaded (the
project list is empty, not absent, before that) and only while no choice was made on this screen.
When the composer has no agent on the selected Host, Home fills in the saved agent if that Host
has it ready, else the first ready one (Claude, Codex, OpenCode, Copilot, then the Host's order),
once per Host and agent, and never while that Host's models are still loading.
Only the focused composer mounts its input/upload UI while retained screens preserve draft state.
A pending template is bound to its Host and applies only while its screen is focused. Selecting
another destination cancels it; unavailable settings on one destination do not block another.
Selecting a conversation from the mobile sidebar records Chat as the Back destination, including
when the sidebar was opened over Inbox.

Inbox replaces the History label at the existing `/sessions` route. It retains search,
Host selection, import, archive/session actions and cursor-based Load more. Type/date filters
run on the daemon before search, sorting and pagination. Current attention/running sessions
are merged into unfiltered results; filtered searches only include matching daemon results.
Search, Host and the Type/Date pills share one filter row; on a phone search takes its own line.

Home and Inbox draw a conversation with one row (`clisbot/home/activity-row.tsx`): title, then
project · workspace · branch · Host, then why it needs you (Needs approval, Failed, Needs you, or
Archived) and its time. A finished reply nobody has read is not Needs you: it stays in Recent with
an unread dot before the title. The branch is omitted when it repeats the workspace; the Host appears only
with several Hosts. Each context part keeps its own search highlight. Inbox reads in a centered
reading-width column. A Host missing from the list is always named: "connecting" while its
connection is pending, the error line once it failed. History's Host reachability used to be read
through a version counter the React Compiler dropped, so a Host that connected after a cold
`/sessions` link stayed "Could not load history" and was never searched; it now depends on the
connection statuses themselves.

## Quick start ownership and persistence

The daemon owns `$CLISBOT_HOME/quick-starts/catalog.json`, an atomic schemaVersion 1 JSON
catalog with `items` and per-owner `preferences`. A record has:

- `id` (`qs_` + 16 hex), name, startingPrompt, timestamps and revision.
- `owner`: `hostOwner`, or `hubUser` with stable Hub backend identity, organization ID and
  authenticated user ID. Hub URL, device/client ID and membership ID are not owner keys.
- `visibility`: `personal` or `host` (shared on this Host).
- `target`: quickChat; bot ID; or project ID with Local / New worktree.
- Worktree base: default branch, fixed ref, or ask at use time (including the existing PR picker).
- `agent`: destination/default settings, or saved provider/model/effort/permission/features.

Preferences hold `pinnedIds` in display order and their own revision. All devices accessing
that Host as the same principal share pins; other users have independent pins. Direct owner
connections use the Host owner profile. Managed sessions without a stable authenticated
identity fail closed and request a Hub update/reconnect.

Creators can publish, edit, unpublish and delete their own records without a Host administrator.
Other users can use/pin shared records or Duplicate to mine. Administrators can maintain shared
records as a cleanup exception; private records remain private. There is no editor ACL or team
role model. Shared visibility grants no project, bot or provider permission. The daemon filters
shared records by current target access, then the ordinary creation pipeline authorizes execution
and the selected agent configuration again. Owners can remove/unpublish an inaccessible record.
Deletion and unpublishing prune other users' pins. Concurrent edits use expectedRevision and
surface a conflict instead of overwriting. The editor keeps the local draft and offers Load latest or
Save as copy; deletion requires confirmation. `quick_start.changed` contains no template content;
subscribers refetch under their current authenticated admission.

Catalogs are Host-local. Switching Hosts changes the library. There is no automatic cross-Host
project mapping, replication or execution on a different Host.

## Starting a session

Applying a Quick start fills the composer; it never sends automatically. Users can review/change
prompt, attachments and agent settings. Missing configured provider/model/effort/mode blocks sending
until the user explicitly accepts current settings. Worktree templates retain only creation intent,
never an existing worktree ID. Each completed use gets a fresh creation identity; retries keep the
same identity. A missing ref or unsupported worktree is an explicit error, not a silent Local fallback.

Project/Quick chat use the existing workspace provisioning and draft handoff. A Host has one Quick
chats project at `$CLISBOT_HOME/quick-chats`; each chat gets its own folder in it
(`<day>-<first words>-<8 hex>`, claimed with a non-recursive `mkdir`) when its workspace is created
at that root, so chats never share files (`packages/server/src/server/quick-chats/`). Folders stay
when a chat is archived. There is no per-user level: access is decided per project, and anyone
allowed a Quick chat already sees every project on the Host, so a per-user folder hid nothing and
split one person's chats between direct and Hub connections. The folder is never a checkout: the
daemon answers "not git" for it and sets `GIT_CEILING_DIRECTORIES` before any git read or agent
launch, because a home inside a repository (a dev checkout, a dotfiles home) otherwise made every
chat a subfolder of that repository, branch and worktree included. T3 Code's Scratch project (`apps/server/src/project/ManagedProjectFolders.ts`, a folder per thread,
feature off inside a repo) and Wayland's temporary workspaces (a folder per chat, no parent-repo
guard) were the references. The
Host names the folder in `server_info.quickChatRoot`; the app uses it alone to keep Quick chats out
of Projects (picker and sidebar) and to list them in the sidebar's Quick chats section, newest first
across Hosts. Quick chat requires Host-wide creation access; `server_info.features.quickChat` says
whether this session has it, and without it the switcher leaves Quick chat out. Project-scoped
members choose an accessible project instead. Bot chat uses `chat.create`
with a per-chat launch configuration; Bot defaults remain unchanged. Its actor-scoped idempotency
key prevents duplicate chat creation on retry. Existing chats without launch overrides continue
to use Bot defaults.

The Quick start editor uses the shared Field/FormTextInput, SelectField, SegmentedControl,
CombinedModelSelector and RadioList components. Default follows the destination/device defaults;
Custom exposes provider/model, effort, permission mode and provider-specific options directly in
this form. Switching Default/Custom retains the custom draft. Provider catalog refreshes validate
without replacing input; unavailable saved settings remain visible and block Save. New records
capture the current composer settings when available, then remain independent of that composer.
The form is a plain TypeScript model. Unsaved drafts stay in memory on Back and can be resumed;
a new edit asks before replacing a dirty draft. Changing Host/principal resets this local state.

Home shows pinned Quick starts as tiles (name, then destination) on a 3-column desktop / 2-column
phone grid, at most two rows; a short last row keeps column width. The section title opens the
library, like the Inbox group titles; there is no separate View all button. With nothing pinned,
the first slot is a tile of the same shape (New quick start, or Pin a quick start once some exist),
so the empty grid still says what goes there. The library groups Pinned on Home (in Home order),
Mine and Shared on this Host; New quick start is its primary action. Search fields and filter pills
use the composer's surface (`surfaceComposer`), so anything you type into reads the same. New quick start opens even before the composer has
a destination: it starts from the first one (Quick chat when available) and the form changes it.

Mobile Quick start library/editor use AdaptiveModalSheet's full-page presentation with header Back/Save. Destination
selection reuses the searchable Combobox bottom sheet; row actions use an action sheet. Android
hardware Back and browser Back/Forward close or restore the top layer first, preserving the underlying editor draft. The web overlay controller consumes its own history entries before Expo Router normalizes them;
only opaque positions enter history, never prompt text. Native page and nested pickers use the
existing isolated sheet stack; BackHeader alone owns the top safe-area inset. Desktop
uses the existing centered modal. Pin tiles occupy up to two rows (4 compact / 6 desktop); all
remaining items are usable from the library.

## Compatibility and rollback

The client extension is owned by `packages/app/src/clisbot/home/feature.ts`.
`EXPO_PUBLIC_CLISBOT_HOME_V2` defaults on; `0` restores previous Home, startup/navigation and
History grouping. The additive daemon catalog remains stored and can be used after re-enabling.
`server_info.features.quickStarts` gates catalog/quick chat and bot launch overrides;
`inboxFilters` gates server type/date filtering. Older Hosts keep ordinary project creation,
search and history pagination. Older Hubs need an update for managed Quick start ownership.
All new shared wire fields are optional; no existing session/workspace/automation records are rekeyed.

## Verification

Focused tests cover catalog persistence and revision races, independent pins, visibility and target
access, trusted identity, managed bot launch authorization, chat retry, per-chat launch isolation,
startup/deep-link precedence, activity date grouping and existing history pagination. Browser tests
exercise daemon synchronization, reload, two fresh worktree starts from one template, mobile tabs and
Back, plus New workspace draft/isolation/background creation regressions. Native results and exact commands are in [verification.md](verification.md); Android must not be inferred
from web viewport tests.
