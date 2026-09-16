# Access: Host scope and bulk grants

**Shipped 2026-09-16.** One Access assignment can cover every Project on a Host while keeping provider and model limits, and one grant action can cover several Projects and several Models.

The rules themselves — scopes, union, availability, approval leaves — live in [permissions](../../permissions.md#access-scopes). This page records what shipped, why, and what is still open.

## What an operator can do

| Need                                              | How                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Every Project on a Host, limited to chosen Models | Resource = the Host, level **Developer** or **Office worker**, then Agent configurations |
| A few Projects on one Host, same choices          | Resource = one Project, then **Also apply to** — one batch, one assignment per Project   |
| Several Models or Thinking options for a Provider | One Agent configuration row, multi-select; a finished row collapses to one summary line  |
| See who can reach a Project                       | View by Resource now includes Host assignments that carry `project.use`                  |
| Read many near-identical grants                   | Rows differing only by Resource group into one line; expand to edit or remove one        |

The confirmation names every Project written, which existing assignments it **replaces** (the write is an upsert), and what **Guest** reaches.

## Decisions

| Decision                                                                                             | Why                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host levels keep the session in Project mode; `daemon.manage` is not reused                          | Administrator mode has no Project filter, so an Agent configuration ceiling has nowhere to be checked                                                          |
| Grants combine by union; a Project assignment cannot narrow a Host one                               | Privileges already add up; one rule for both privileges and constraints. Considered intersection and rejected it                                               |
| Availability is not authority; catalogs are read from live Projects only                             | A partial daemon snapshot must not drop access, but a stale catalog must not offer Host choices or vouch for an attended Mode the daemon may have reclassified |
| **Also apply to** is limited to one Host                                                             | A Host publishes one catalog and needs one `daemon.connect` row. "All Projects" is a Host assignment, not N rows                                               |
| One Agent configuration row is one stored grant, never split per Model and never merged per Provider | Splitting turned one decision into many cards; merging loses per-Model Thinking choices                                                                        |
| `developer` equals `full_access`, both ids kept                                                      | The level that earns more is a per-Project, per-action approval policy. Keeping both ids avoids a rename then                                                  |
| Unclassified tools map to `approval.other`; no separate `agent.unattended.use`                       | A request no level can answer hangs. Suppressing prompts still means holding every approval leaf                                                               |

## Code

- Levels and leaves: [`contract.ts`](../../../packages/hub/src/access/contract.ts); Host scope, validation, Host catalog: [`store.ts`](../../../packages/hub/src/access/store.ts)
- Approval classification: daemon [`resource-authorizer.ts`](../../../packages/server/src/server/managed-access/resource-authorizer.ts), channel [`approvals/index.ts`](../../../packages/hub/src/channels/approvals/index.ts)
- UI: [`access-assignment-form.tsx`](../../../packages/app/src/clisbot/hub/settings/access-assignment-form.tsx), [`agent-configuration-grant-fields.tsx`](../../../packages/app/src/clisbot/hub/settings/agent-configuration-grant-fields.tsx), [`multi-select-field.tsx`](../../../packages/app/src/clisbot/hub/settings/multi-select-field.tsx), [`access-overview.ts`](../../../packages/app/src/clisbot/hub/settings/access-overview.ts)
- Tests: [`host-scope.test.ts`](../../../packages/hub/src/access/host-scope.test.ts), web/channel [`resolve-access-parity.test.ts`](../../../packages/hub/src/access/resolve-access-parity.test.ts)

## Open

- **Per-Project, per-action approval policy** — which actions need an explicit prompt and who may answer each. It is what will separate `developer` from `full_access`.
- **Stored grants need a re-save** before they qualify for unattended execution again — [permissions](../../permissions.md#approval-leaves).
- **Two destructive-command lists** — [`policy.ts`](../../../packages/hub/src/channels/policy.ts) has 24 patterns, the daemon authorizer 8. Harmless while every level that approves commands also holds the destructive leaf; a hole once one does not.
- Changing the Model set resets Thinking to all options (existing behavior), and the confirmation does not show Thinking.
- Verified by store, form, and web/channel parity tests; not yet in a running app or on a live Slack/Telegram surface.
