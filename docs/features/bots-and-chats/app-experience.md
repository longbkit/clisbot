# Bots and Chats app experience

Date: 2026-09-27. Approved interaction contract; implementation and verification are tracked in
[implementation.md](implementation.md). This revises the earlier hidden Bot projects toggle and
automatic navigation to cowork when opening a chat artifact. The daemon's Bot/Chat/session ownership,
turn rules, grants and execution remain unchanged.

## Navigation

- Account access sits with the organization context at the top, on desktop and mobile.
- Primary navigation is New workspace, Search, History, Automations. Search extends the existing
  Command Center; it is not a second search system. Bots and group chats register as contribution
  sections (`clisbot/bots/search/`): **Bots** match name, Role or `@slug` and open the bot's
  chat; **Group chats** match the title or a member's name. New bot and New group chat join
  Actions and ask the sidebar to open its sheet. All show only for a query, and rank above
  Workspaces, so a bot's own workspace no longer stands in for the bot. Message text is not
  searched yet; that needs a daemon search.
- Pinned appears before Group chats, Bots, Projects and Bot projects. Pins can identify a bot,
  chat, project, workspace or session; a pinned flat conversation is not repeated in its collection.
- Section collapse state is a view preference. Bot projects is always available, initially
  collapsed, and remembers subsequent changes. No separate visibility toggle remains.
- Preserve existing workspace/session rows, project filters, display preferences and shallow
  indentation. Creation actions remain discoverable on section headings. Avoid unread-count badges.
- Footer retains Add project, Hosts, Import session, Help and Settings. Account is no longer there;
  there is no additional theme shortcut.

Workspace pins keep their existing owner. Additional resource pins are client view preferences,
not new daemon grants or a synchronized team pin contract. Resolve every pin against the current
accessible catalog and scope identity by Host and resource. An inaccessible resource must not be
rendered from stale pin metadata.

The Bots directory filters the accessible catalog by Host and sorts by Recent or Name. Mine and
Shared with me use the optional, session-projected `BotPayload.isOwner` value, never `canConfigure`
or template kind. Ownership compares the same canonical actor identity used at creation; it neither
grants access nor changes stored Bot data. Older Hosts omit the projection, so ownership is unknown
and remains visible under All rather than being guessed. Large Pinned lists use Show more/less.

## Automations

One destination has Home, Schedules and Automations tabs. Home previews each collection with its
own create action and See all, plus a short guide. Existing schedule and automation forms remain
the mutation owners. Host schedules must remain usable without a Hub. Hub connection, organization
selection and authority are still required for the corresponding automation operations. The combined
destination does not introduce a third execution engine or silently convert one resource into another.

## Creation and configuration

New bot and Bot settings are one form of labeled fields under the sheet title, no intro heading:
who the bot is (**Name**, **Role**, **Template**), then **AI configuration**. Template is Personal
or Team side by side on one row (`kind` remains the stored wire field); it is fixed once the bot
exists. A template seeds instruction and workspace files, not just memory. It does not grant
Project Access.

AI configuration stays one group, a card of labeled rows: Host, Model, Permissions, Thinking
(`clisbot/bots/create/bot-setup-rows.tsx`). Every row is always shown, so the user sees the Host
and permission mode the bot will run with even when there is one choice; a row with options has a
chevron and opens its own picker, a row without shows the value it will use. The Model row names
provider and model with the provider's icon. An unlabeled summary ("Grok · Grok 4.6 / Default mode
· High") behind a Customize button did not say which value was which or that it could be changed,
and splitting the settings into separate fields lost the grouping and hid rows with one choice. Every default is filled so Name and Enter create the bot: the Host in the route, else the Host of
the most recent chat, else the only Host; the device's saved AI choices, else the Host's first
ready provider and its default model. Creating a bot saves its AI choices for the next one
([README D11, D12](README.md#d11-templates-move-into-the-daemon)).

**Apply
agent profile** is a one-time action copying a saved launch bundle into those controls. There is no
selected or default profile binding; see [the glossary](../../glossary.md). Reuse existing
preference resolution and validate the selected Host/provider. Do not introduce a hidden Full access default.

New group is Host (only when there is a choice), **Members**, **Group name** and **Who replies?**,
as flat fields under the sheet title; a section label weaker than the field labels reads as noise.
Members is one field shared with Group settings (`clisbot/bots/chat/bot-members-field.tsx`): the
bots already added, each with face, name, Role and a remove button, above a search that adds more.
Opening New group opens that search with the cursor in it, because picking bots is the first thing
to do; typing filters by name or Role and Enter adds. Picking members is a list with a search, not
switches or checkboxes: switches are for settings that turn on and off.

One bot is enough for a group. A one-bot group is a separate thread with the same bot, so a user
can keep topics apart without creating another bot; the last member cannot be removed. The default
is every bot, one at a time, when no one is mentioned; an explicit mention addresses only the
mentioned bots ([group discussion](plans/group-discussion.md)). Mention-only is the alternative. Hide numeric hop and input-length limits from
ordinary creation without changing server defaults. Host changes reset incompatible bot selections;
retain other draft fields. Create failures retain input and do not show success prematurely.

## Chat, files and cowork

Chat owns its conversation layout; a real bot Workspace owns each file/resource operation. Never use
a synthetic chat layout identifier as the workspace identity sent to the daemon.

- Messages is the fixed conversation tab. Keep the current ChatScreen/ChatComposer, tool sheets,
  approvals and dictation. The composer is outside the scrolling message list. Attachments use the
  existing upload/image pipeline and canonical chat submission. The selected bot's current session
  supplies model controls, voice and Stop; the draft remains owned by the chat. Conversation submits
  never enter the ordinary agent message queue. Before a first session exists, voice remains visible
  with an explanation; attachments and dictation are already usable. Hosts without the
  `bots` capability (README D10) cannot silently accept and discard attachment payloads.
- Opening an artifact does not navigate to cowork. Desktop uses the existing ordinary side-pane
  opener: create a right split on first open; reuse the remembered pane for subsequent opens; reveal
  an already-open file without overriding a tab the user moved. Explorer is a separate dock.
- File identity includes Host, source workspace and path. Two bots can produce the same path. Changing
  the selected bot must not retarget an open document or grant access to another source.
- Files, Changes, file preview and diff rendering reuse current workspace components unchanged.
  A DM resolves its bot project directly. A group adds a bot/context selector; the selected context
  drives Explorer, Git actions and the Cowork action. Preserve backend authority and Git capability
  checks. A project can exist before there is a participant session to open in cowork.
- The chat header shows a secondary summary: group member count plus open tab count, or the Host
  display name plus open tab count for a DM. Both the heading and overflow button open the same
  Chat options menu. Keep tab count visible when a long Host name truncates.
- Cowork is an explicit compact button with a folder outline with a simple smiling bot face and an Open in cowork tooltip.
  Reserve the Monitor icon for remote browser/computer/simulation views. Group
  selection must resolve the intended participant/context. Back to chat returns to the origin DM or
  group, retaining its draft, reading position and document tabs. Do not choose an unrelated session.
- Mobile reuses the existing left/center/Explorer selection model and tab switcher. Opening a file
  closes Explorer and reveals the file in the center. Selecting Messages returns to chat. No second
  drawer controller, meaningless add-tab button beside Messages, or mobile pane-maximize action.
- Chat options uses the shared compact action menu. Switch tab searches open conversation tabs by
  filename, path and source bot, then focuses the existing tab through the layout store. Pin,
  bot settings and archive stay single-row actions; participants/replies and project controls open
  separate detail sheets. Archive requires confirmation. The fresh-session entry explains `/new`
  and returns to Messages without overwriting the draft or sending a command.
- Both tab pickers keep the tab name on the primary line. DM tabs omit the repeated bot name;
  group file tabs identify the source bot below the filename and Messages uses “Group conversation”.
  Nested files show their directory on the secondary line to distinguish duplicate filenames.
  Tab-type icons distinguish Messages, documents and changes without changing their names.

## Responsive controls and compatibility

Desktop retains its compact workspace header and tab styling. Mobile uses the existing responsive
header geometry: shared toolbar button frames, a consistent 4px action gap, and vertical hit slop
without overlapping adjacent targets. Preserve
keyboard/safe-area behavior; do not pin the composer to the browser page independently of the pane.

Keep Fusion code under its existing extension/capability boundaries. Ordinary workspace targets,
file renderers, schedule mutations, Hub automation mutations and disabled-Bots behavior remain
compatible. New persisted client layout fields must be optional and round-trip safely.

## Acceptance evidence

Targeted checks must cover source-scoped file identity, existing file reveal/right-pane reuse,
mobile Messages switching, explicit cowork return, collapse preferences, new creation validation,
and unified navigation without crossing Host/Hub authority. Browser verification must exercise both
wide and narrow viewports. A narrow browser viewport does not substitute for native device keyboard,
safe-area and gesture testing; report that distinction in the implementation record.
