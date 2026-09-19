# Delegated access, People, and Route audience: implementation plan

Status: all six workstreams shipped 2026-09-19 in commits `2cf04acf2` (access, People), `afdf0d51d` (Route audience rules), `39f55dddc` (Automations), with fixes in `ca4e311b1` (Channel Route grants only Admin) and `c4bbc5c10` (catch-all removed). Coordinator follow-ups so far: `contracts.ts` (team kind, `createdByUserId`, `HUB_ACCESS_INCLUDE`, access events, invitation `createdAt`), Hub navigation items from effective grants (`settings/catalog.ts`), a Connect-only Host row allowed for a Project sharer (`grantor.ts`), Access page opening on `?resourceKind=&resourceId=`, the workflow editor's Route summary reading audience rules. Decisions this plan implements:
[Delegated access](scoped-admins.md), [Route audience rules](../../audits/2026-09-19-route-audience-rules.md),
and the People page redesign recorded below (its decision lives only here).

Everything here is Clisbot scope (`packages/hub`, `packages/app/src/clisbot`). No
upstream Paseo file changes; no protocol package changes. An unmodified Paseo app
still pairs with the daemon; Hub features are already gated by Hub presence.

## Workstreams and file ownership

Two agents never edit the same file. New handlers go in new files; `management-api/index.ts`
only gains dispatch lines.

| Id  | Workstream                                            | Owns                                                                                                                                                                                                                                                      | Depends on             |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| A   | Hub: Can share, scoped Admin, Team Admin              | `packages/hub/src/access/*`, `packages/hub/src/management-api/access-delegation.ts` (new), `management-api/teams.ts` (new; move team handlers there), `auth/organization-access.ts` (Team Admin invitations), dispatch lines in `management-api/index.ts` | —                      |
| B   | Hub: Route audience rules                             | `packages/hub/src/channels/**`, `management-api/channel-admin.ts` (new), dispatch lines in `management-api/index.ts`                                                                                                                                      | —                      |
| C   | Automations for non-admins (hub + app)                | `packages/hub/src/triggers/**`, `management-api/automations.ts` (new), `packages/app/src/clisbot/hub/settings/automation-*`                                                                                                                               | A                      |
| D   | App: People page and Owner role                       | `packages/app/src/clisbot/hub/settings/team/**`, `channel-identity-*`, `access-summary.tsx`, `summary-stats.tsx`, `resource-rows.tsx`, `labels.ts`                                                                                                        | A (read-only contract) |
| E   | App: grant form Can share                             | `packages/app/src/clisbot/hub/settings/access-*`                                                                                                                                                                                                          | A                      |
| F   | App: Route audience editor, Channel Route Admin views | `packages/app/src/clisbot/hub/settings/channel-*` except identities, `channel-route-*`                                                                                                                                                                    | B                      |

Shared files (`packages/app/src/clisbot/hub/contracts.ts`, `docs/glossary.md`) are edited
only by the coordinator after each wave.

## Contracts between workstreams

### A → app (D, E, C)

- `hub.access.manage` becomes grantable on `daemon`, `project`, `team`, `channel_account`,
  `automation`. It is **Can share** on Host/Project and **Admin** on the others. Same grant row
  as the level; `createdByUserId` already stored, now returned by the assignments list.
- Rule: the actor grants at most what they hold on that resource (level privileges ⊆ own, and
  `hub.access.manage` only if held). Organization Owner/Admin bypass. Error code
  `access_exceeds_grantor`.
- Full access and Administrator levels imply Can share: the Hub adds `hub.access.manage` when
  saving those levels, so old rows without it read the same (COMPAT tag at the read site).
- New resource kind `team` appears in `access-catalog` and assignments **only when the request
  sends `?include=team`**. Older apps parse `resourceKind` with a closed enum
  (`contracts.ts`); tag the filter `COMPAT(team-resource-kind)`.
- Team Admin (`hub.access.manage` on `team:<id>`) may: add/remove Team members, create
  invitations whose `teamIds` are only their Teams and whose role is `member`, appoint
  another Team Admin of the same Team. Not: change Team grants, delete the Team.
- Granting the Host level Administrator records an `access_event` and notifies every
  Organization Admin (email through the existing sender when configured; always the event row
  the app can list at `access-events`).
- Effective-access endpoint (`members/:id/effective` and the viewer's own) includes
  `hub.access.manage` in privileges so the app can decide what the viewer may grant.

### B → app (F)

- Route gets `audience: AudienceRule[]`; `match` and the one-value `audience` are read
  through migration (`COMPAT(route-audience-rules)`).
- Compiled Route exposes `audienceRules` plus derived `where` for matching. Validation
  responses report per-rule problems with `path: routes[i].audience[j]`.
- Channel Route Admin (`channel.manage`, or Organization capability) may: save that one
  account's file (`channel-configuration/accounts/:channel/:accountId`), read that account's
  activity and ingress, relink. Not: bot token, Connection, the policy file.
- `channel.use` grants stop being created; existing ones are migrated into rules on every Route
  of the account by a one-time job on Hub start, then the grant rows are deleted.

## People page decision (D)

- Page title **People**; tabs Members / Teams / Invitations in `?view=`.
- **Invite people** button in the header opens a modal: one field for names and emails
  (existing Members are recognized), role, Teams, preview of what will happen.
- Overview counts become clickable filter chips.
- Channel identities: a column on Members and a section in Member detail; the self-link form
  moves to the account settings. The Channel identities tab is removed.
- Member detail: role dropdown Member / Admin / Owner (Owner option only for Owners, with
  confirmation; last Owner cannot step down; Admin sees an Owner's role read-only); Remove
  in a Danger zone, not beside the role buttons.
- Access summary grouped by resource kind, level worded by `access-level-summary.ts`,
  "every Project" for Host grants, raw privileges collapsed.

## Verification

Per workstream: `npm run typecheck`, `npm run lint -- <files>`, `npx vitest run <changed test
files> --bail=1`. No full suites. Coordinator runs the same after each wave and updates
`docs/glossary.md`, `docs/features/access/README.md`, and this file.

## Known exceptions

- `team-configuration-settings.test.tsx` (959 lines) and `access-settings.test.tsx` (992 lines) exceed the 700-line file limit. Both are single-suite jsdom tests whose `vi.mock` preamble must stay in one file; split when the preamble is extracted into a shared setup module.
