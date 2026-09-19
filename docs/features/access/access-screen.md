# The Access screen: problem, model, layout, interaction

People › Access is where an organization decides who may use what. This doc
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

- **Who**: a Member, a Team, or Guest (channel senders without a linked Member).
- **Resource**: a Host, a Project (its Host is its parent), a Team, a
  Connection, or an Automation.
- A Member's access is their own grants **plus their Teams' grants**. A Team
  grant is edited on the Team, never on each Member.
- Grants combine by union; there is no deny.

## Layout

The standard layout for this kind of screen (cloud IAM consoles, GitHub
organization roles, workspace sharing) is **one list of grants**, not a picker
you must fill in before anything shows:

```
Access ⓘ                                              [Grant access…]
[ Search people, Teams, resources            ]  [ People | Resources ]

 Who / Resource            Level           Details               Granted by
 ─ QC (Team · 3 Members) ─────────────────────────────────────────────────
   LongPro2Max.local       Developer       Can share             Hoa     Edit …
   Host
   brain                   Office worker   Claude only           Hoa     Edit …
   Project · LongPro2Max.local
 ─ Ai Tran (Member) ──────────────────────────────────────────────────────
   Support                 Admin                                 Owner   Edit …
   Connection
   brain                   Office worker   via Team QC
```

- **Everything shows by default**, grouped. _People_ groups by who holds the
  grants; _Resources_ groups by what they are on. Search narrows both.
- **Columns hold one fact each**: the thing (name, then its kind and parent
  under it), the Level, its modifiers, who granted it. No sentence joined
  with "·" that has to be parsed.
- **A Member's group also lists what their Teams give them**, marked "via Team
  …", with no actions: that grant is edited on the Team. A Member whose only
  access comes through Teams still gets a group.
- **On a phone** a grant is a card: the thing, then Level, Details and Granted
  by as labelled lines, with its actions at the top right.
- Below the list, folded: **Access events** (job 4) and **Routes open to
  anyone** (who can chat without any grant; it belongs to Channels and is
  listed here only as exposure to review).

## Interaction

- **Grant access…** in the header opens the grant sheet. It opens pre-filled
  when the page was reached for one person or resource (a Member's _Manage
  access_, a Connection's _Manage Admins_).
- **Edit** on a row opens the same sheet for that grant. **Remove** is in the
  row's **…** menu, with a confirmation, so it is never next to Edit.
- A grant above the viewer's own level shows **Above your level** instead of
  actions: they can see it, not change it.
- A Member who manages no one sees the same list, read-only, of their own
  access, with Levels named from the catalog the Hub sends with it. Who
  granted each is not part of that view, so the column is absent.
- A Team's and a Member's detail pages show their grants in the same table
  (`SubjectGrantsTable`), read-only, without the group header the page
  already names. Change them with **Manage access**, which opens this screen
  for them.

## Components and readability

- The list is `settingsStyles.card` rows in a header-row table on wide screens
  (the same pattern as People › Members), cards on a phone.
- The thing's name and the Level are foreground text at base size; kinds,
  parents, modifiers and Granted by are muted at base size. Nothing a reader
  must act on is in the small size.
- Search is `SearchField`; the grouping is `SegmentedControl`; row actions
  are an **Edit** button plus `RowActionsMenu`; section explanations are the
  header's info tip, never a paragraph above the list.
