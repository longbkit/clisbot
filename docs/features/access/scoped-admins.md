# Delegated access: Can share and scoped Admins

Status: decided 2026-09-19; Automations (step 4) built the same day. Build order is at the end.

One rule covers every delegation: **you grant at most what you hold.** It has no exceptions, so a user learns it once.

Two words carry it:

- **Can share** — on a Host or Project grant: add, change, or remove people on that resource, up to your own level.
- **Admin** — on a Team, Channel Route, or Automation: manage that one resource and who gets into it. The scope is always named (Team Admin, Channel Route Admin, Automation Admin). Organization Admin is the existing organization role.

## Why

A QC lead needs to manage the people on their own Team and Host. Today the only way to let someone grant access is to make them an Organization Admin, which hands over every Member, Team, Host, grant, and Channel of the organization. Only Channel Route has a narrower grant (**Manage**), and it works only from chat.

## Host and Project: Can share

| Level         | Can share                 |
| ------------- | ------------------------- |
| Connect       | No                        |
| Office worker | Off by default; can be on |
| Developer     | Off by default; can be on |
| Full access   | Always on                 |
| Administrator | Always on                 |

- **Up to your own level.** An Office worker who can share adds Office workers. An Administrator can grant Administrator.
- **Can share passes on** within your level, as a Drive editor can invite another editor.
- **You change or remove only grants at or below your level.** Higher grants show locked.
- **A Host grant reaches every Project on it**, so sharing a Host shares its Projects. Project grants follow the same rule inside one Project.
- **Granting Administrator warns** that the person will control the daemon: restart, install plugins, use every Model, see every Project. Every Organization Admin is notified with the name of who granted it.
- **Every grant shows who made it** ("by Hoa"), so it can be revoked at once.
- Organization Owners and Admins are not limited by this rule.
- Host name, daemon link, managed access mode, and removing the Host stay with Organization Admins: one Hub lists many Hosts, and a change by one team confuses everyone else who uses it.
- Later, if an organization needs it: a policy "Only Organization Admins grant Administrator", off by default and invisible otherwise.

The Host level keeps the name **Administrator**. Because it can share, it now manages access the way "Admin" means everywhere else, so there is no naming conflict with Team or Organization Admin.

## Team, Channel Route, Automation: Admin

| Scope         | Admin manages                                                                                                             | Excluded                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Team          | Who is in the Team: add, remove, invite into it, appoint another Team Admin                                               | The Team's access grants                                                   |
| Channel Route | Its Routes and Route defaults, status, relink, its own activity, its audience rules, granting Admin — in the app and chat | The bot token, creating or deleting the Connection, the shared policy file |
| Automation    | One Automation: edit, enable, delete, grant Run or Admin                                                                  | Every other Automation                                                     |

Who may talk to the bot is decided only in the Route's audience rules ([2026-09-19](../../audits/2026-09-19-route-audience-rules.md)), which a Channel Route Admin edits. The Channel Route's Access tab keeps only Admin; Use is no longer granted there. Channel Route **Manage** is renamed **Admin**; the wire key `manage` stays. Only an Organization Admin deletes a Team or Channel Route.

## Automations

Built 2026-09-19 ([`management-api/automations.ts`](../../../packages/hub/src/management-api/automations.ts), [`triggers/author-access.ts`](../../../packages/hub/src/triggers/author-access.ts)).

- Anyone with work access to a Project (`project.use` on a Host or Project) can create an Automation. The same delegation check as before (`assertAutomationConfigurationDelegation`, [`delegation.ts`](../../../packages/hub/src/access/delegation.ts)) keeps its targets and Agent configurations inside the creator's own grants; a target they do not hold is `access_denied`.
- The creator becomes Admin of that Automation: an ordinary `automation` assignment with `["automation.run", "hub.access.manage"]`, written by the creator. Organization Owners and Admins get no row; their role already covers it.
- Admin reads, edits, enables, and grants on that one Automation. Run (`automation.run`) reads it and its runs and starts it. The list answers with each Automation's `scope` (`admin` or `run`), its `author`, and its `target` (Host and Project names); Organization Admins see every Automation.
- **Run works like Channel Route Use.** The Automation's Access section and the grant form warn: "Runs with <author>'s access on <project>. The runner sees results but gets no Project access in the app." Nothing else is special server-side.
- Every accepted run re-checks the author's access with the save-time check, keyed by the revision's `createdByUserId`. When it fails, the Hub disables the Automation with a `pausedReason`, records the run as rejected (`author_access_lost`), writes an `automation_paused` access event, and emails every Admin of the Automation. Any Admin lifts the pause by saving the Automation again, which runs the check again. Revisions without an author (imported from GitHub, or older than the field) are not re-checked.
- Members author manual and Channel inputs only. A Connection-sourced input (GitHub, Slack, Discord, Linear) is `automation_input_requires_admin`; `env` and GitHub authority are `automation_secret_requires_admin`. There is no admin-provided secret reference yet, so a Member's Automation carries no secrets at all. Deleting an Automation is not offered to anyone yet.

## Storage

- Can share and scoped Admin are `hub.access.manage` in the same grant as the level. Hosts keep one grant per subject. Today that privilege is derived from the organization role and no resource accepts it ([`store.ts`](../../../packages/hub/src/access/store.ts) `PRIVILEGES_BY_RESOURCE`). Channel Route Admin keeps `channel.manage`.
- Team Admin needs a new resource kind `team`. The app parses `resourceKind` with a closed enum (`packages/app/src/clisbot/hub/contracts.ts`), so an older app would reject a catalog containing it. Gate it per [protocol compatibility](../../protocol-compatibility.md).
- Assignments already store `createdByUserId` (`AccessAssignmentRecord` in [`store.ts`](../../../packages/hub/src/access/store.ts)).
- Channel Route Admin in the app needs a per-account save of the channel configuration (it is one organization-wide file set today) and account-filtered activity and ingress. The per-Route delegation check already exists for `/promoteroutedefault`.

## Options considered

| Option                                                   | Outcome                                                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Make leads Organization Admins                           | Rejected: every Member, Host, grant, and Channel                                                                |
| Sharing only from Full access up (GitHub, GitLab ladder) | Rejected alone: a lead would need Full access, and an Office worker lead could never share. Kept as the default |
| A separate "Host Admin" flag beside the levels (Azure)   | Replaced by Can share: same flexibility, and no second "Admin" next to the Administrator level                  |
| Per-resource sharing switch (Google Drive)               | Not needed: sharing follows the level, and Can share covers the exceptions per person                           |
| Administrator cannot grant Administrator                 | Rejected: an exception users must remember. Replaced by the warning, the notification, and the optional policy  |
| Runner without Project access cannot run an Automation   | Rejected: an Automation is shared as a tool, like Channel Route Use; the warning makes the trade visible        |

## Build order

1. Team Admin: membership only.
2. Can share on Hosts and Projects, with the Administrator warning and notification.
3. Channel Route Admin in the app.
4. Automation creation by non-admins, per-Automation Admin, Run warning, pause on lost access.
