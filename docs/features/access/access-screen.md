# The Access screen: problem, model, layout, interaction

People & access › Access is where an organization decides who may use what. This doc
sets its shape from the job, so later fixes land inside one model instead of
piling onto the page. Levels, Host scope and grant rules are in
[Access](README.md) and [Delegated access](scoped-admins.md); this doc is only
the screen.

## The jobs, most frequent first

1. **Who has access to this?** Sharing a Host or Project, checking before a
   change, auditing a Connection's Admins.
2. **What can this person or Team use?** Onboarding, offboarding, answering
   "why can't Ai open this Project".
3. **Grant, change, or revoke** a grant.
4. **Review sensitive changes**: an Administrator grant on a Host, an
   Automation the Hub paused.
5. For a Member who manages no one: **what can I use**.

## The model the screen shows

One grant is **Who × Resource × Level**, plus two modifiers: **Can share**, and
**Agent limits** (providers, models, Fast mode) on Host and Project grants.
Also **Terminal** and **Terminal profiles**;
see [Terminal profiles and Project creation](terminal-and-project-creation.md#screens).

- **Who**: a Member, a Team, or Guest (channel senders without a linked Member).
- **Resource**: a Host, a Project (its Host is its parent), a Team, a
  Connection, or an Automation.
- A Member's access is their own grants **plus their Teams' grants**. A Team
  grant is edited on the Team, never on each Member.
- Grants combine by union; there is no deny.

## Layout

An organization has hundreds of Members and dozens of Teams, so the screen
never lists every grant at once. It is **master and detail**, the layout cloud
IAM consoles and GitHub use for the same job: pick one person, Team, or
resource, then read only its grants.

```
Access ⓘ
View access by  [ People and Teams | Resources ]

[ Search people and Teams ]            Alice Example                [Grant access…]
(All 178) (Teams 12) (Members         alice@example.test
 165) (Guest 1) (With access 38) (No access 140)
┌──────────────────────────────┐       Resource          Level      Details        Granted by
│ QC            Team · 9       │       Example Workstation       Developer  Can share      Hoa    Edit …
│ Alice Example       ai@…   3 grants│ ◀     Host · example.test
│ Bao           bao@…  1 grant │       brain             Office     via Team QC    Hoa
│ …                            │       Project · Example Workstation
│ Show 50 more of 312          │
└──────────────────────────────┘
```

- **View access by** names what the list holds: _People and Teams_ (who holds
  grants) or _Resources_ (what grants are on). The label is part of the
  control, so the switch reads as a choice of axis, not as a filter.
- **The list scales by narrowing, not scrolling**: search (name or email),
  kind chips with counts, then _With access_ and _No access_. The list opens on
  _All_, so nobody without access is hidden by default. It shows 50 entries,
  then _Show more_. Members show their email, so two with the same name are
  told apart.
- **An organization role counts as access.** An Owner reaches everything and an
  Admin manages Members, Teams, Connections, and Access without a grant, so
  neither lands in _No access_. Their row reads _Owner, full access_ or
  _Admin role_. The detail opens with a callout for the role (green for Owner,
  blue for Admin, which still needs a grant for Hosts and Projects), and an
  Owner's detail has no _Grant access…_, since a grant would change nothing.
- **The detail is one entry's grants**, one fact per column: the thing (name,
  then its kind and parent), the Level, its modifiers, who granted it. A
  custom grant reads _Custom · N privileges_; the list is in the grant sheet.
- **A Member's detail lists their Teams first**, every one of them with what
  it grants (_2 grants_ or _No access_), and a Team opens on press. A Team
  that grants nothing adds no rows to the grants table, so without this list
  it would be invisible why the Member has no access.
- **Grant access… on a Member in Teams is a menu, Teams first.** It lists the
  Member's Teams under _Recommended: grant to a Team_, then _Only <Member>_ for
  a direct grant. A Team grant covers people added later and is one row to
  review; a direct grant stays when the Member leaves their Teams. A Member in
  no Team gets the plain button.
- **A Member's grants include their Teams'**, with an **Access via** column
  (_Direct_ or the Team, which opens it). A Team row is the Team's grant, so
  its action is **Edit on Team**: the sheet opens on the Team's grant with a
  warning that saving changes it for everyone in the Team. Its **…** menu has
  _Open Team …_ and _Grant directly instead…_, a new grant to this Member on
  the same resource for when one person needs something the Team should not
  get. This is the IAM "inherited from" pattern: you always see where access
  comes from, and change it at its source. A Project lists the Host grants
  that reach it the same way (_Edit on Host_). Either way the entry counts as
  having access.
- **Side by side only when both fit** (about 880px of Settings column);
  narrower, and on a phone, the list is one screen and the entry another, with
  a back link. On a phone a grant is a card with labelled lines.
- Below, folded: **Access events** (job 4) and **Routes open to anyone** (who
  can chat without any grant; it belongs to Channels and is listed here only
  as exposure to review).

## Interaction

- **Grant access…** is on the open entry and opens the grant sheet pre-filled
  with it. A link for one person or resource (a Member's _Open in Access_, a
  Connection's _Manage Admins_) opens the screen on that entry.
- **Edit** on a row opens the same sheet for that grant, which is also where
  its full detail is (every Agent configuration, Terminal profile, and
  modifier). **Remove** is in the row's **…** menu, with a confirmation, so it
  is never next to Edit. A Member's page in People has the same row actions,
  in a sheet over the page.
- A grant above the viewer's own level shows **Above your level** instead of
  actions: they can see it, not change it.
- A Member who manages no one sees the same table, read-only, of their own
  access, with Levels named from the catalog the Hub sends with it. Who
  granted each is not part of that view, so the column is absent.
- A Team's and a Member's detail pages show their grants in the same table
  (`SubjectGrantsTable`), read-only. A Member's page grants in place: its
  **Grant access…** is the same menu (their Teams first, then _Only <Member>_)
  and opens the same sheet over the page (`GrantAccessSheet`, sharing the
  Access screen's queries and save in `access-queries.ts`). **Open in Access**,
  shown once they have grants, opens this screen on them to edit or remove
  one. A Team's page still has **Manage access**.

## Components and readability

- The master-detail shape is the one Channels › Channel Integrations uses;
  the list chips are `FilterChips`, search is `SearchField`, the axis is a
  labelled `SegmentedControl`, row actions are **Edit** plus
  `RowActionsMenu`, explanations are the header's info tip.
- Surfaces come from `table-styles.ts`, shared by every Hub table and
  selectable list: a grey header row, white rows, and a selected row a full
  step darker. A plain settings card (surface1) is too close to surface2 for a
  header or a selection to read against it.
- The thing's name and the Level are foreground text at base size; kinds,
  parents, modifiers and Granted by are muted at base size. Nothing a reader
  must act on is in the small size.
