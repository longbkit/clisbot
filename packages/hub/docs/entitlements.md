# Entitlements

Core product feature: what an organization is allowed to do. Self-hosted instances use this
alone. Nothing in `src/entitlements/` imports Stripe or anything from `src/billing/` — a
self-hoster never needs to read docs/billing.md.

## Model

An organization holds one row: `granted` (stamped from a plan template or provisioning),
`overrides` (hand-set by an admin), and `effective` (the merge, overrides winning — see
`effectiveEntitlements`, `src/entitlements/catalog.ts:241`).

The two are kept apart so a plan re-stamp can overwrite `granted` freely without ever touching
`overrides`. A custom deal for a customer is a standard plan plus overrides, never a new plan
row, and it survives every later plan sync intact.

Entitlements are materialized onto the organization rather than referenced by plan id.
Enforcement only ever reads the organization's own row; changing a plan means re-stamping the
template onto every affected organization. This is also what makes deleting `src/billing/` safe:
organizations keep whatever they were last stamped with, and nothing in enforcement breaks.

## Caps, flags, meters

Three kinds, two homes:

- **Caps** (`seats.max`) and **flags** (`canInviteMembers`) check against a live count or
  boolean. They live in `organization_entitlements` (`src/db/schema.ts:1035`) with
  `granted`/`overrides`.
- **Meters** (`executions.monthly`) need a rolling counter and a reset window, so usage lives
  separately in `organization_usage` (`src/db/schema.ts:1073`), keyed by
  `(organization_id, meter, period_start)`. Only the _limit_ lives in the entitlements document
  (`meters` in `entitlementsSchema`, `src/entitlements/catalog.ts:11`), so a meter limit
  overrides exactly like a cap does.

`entitlement_changes` (`src/db/schema.ts:1047`) is an append-only audit of every stamp, override,
and clear. "Why does this org have 50 seats" is a real support question, and this table is the
only answer — it can't be backfilled, which is why it shipped in the first slice rather than
later.

## Interface

`EntitlementsService` (`src/entitlements/service.ts:85`) is the whole surface: `read`, `stamp`,
`override`, `clearOverride`, `requireFlag`, `requireHeadroom`, `consume`, plus
`usage`/`overages`/`history` for display.

`requireHeadroom(organizationId, "seats")` does not take the current count from the caller. The
counting query is wired once into a registry at composition (`EntitlementCounters`,
`src/entitlements/service.ts:58`), so a call site never learns how a cap is counted. The seat
counter itself lives in `src/auth/organization-access.ts` rather than the `Database` interface —
it counts members and pending invitations, which are Better Auth tables the in-memory `Database`
doesn't model — so it's exercised only through E2E, not unit tests.

`consume` is a single conditional upsert (`Database.consumeOrganizationUsage`), not a
read-then-write: two statements race under load. Proven with 20 concurrent callers against a
limit of 5 yielding exactly 5 successes, against real Postgres.

## Surfaces

Limits, billing, and usage are three separate concerns; three surfaces read and write
entitlements, each gating on a different thing. Tying them together is the mistake this split
exists to prevent — a self-hosted operator sets per-org limits with no Stripe anywhere, and those
teams still see their own limits and usage.

- **Usage** (`src/usage/`) — org-scoped, read-only, always present. Any member sees the
  organization's effective limits, current usage against the meter, the over-limit banner, and the
  change history. No billing gate, so it renders identically self-hosted and hosted. Resolves
  through the organization's own membership.
- **Operator** (`src/operator/`) — instance-scoped, gated on `user.is_instance_operator`. The only
  surface that writes overrides: an operator picks any organization and sets or clears its limits
  with a required reason. It is not a membership read — an operator acts on organizations it does
  not belong to — so it has its own resolution (`Database.findOrganizationForOperator`) gated on
  the flag rather than borrowing `resolveRouteTenant`. Authorization is server-side: `OperatorConsole`
  refuses every read and write without the flag, independent of what the client sends. Hiding the
  nav is only presentation.
- **Billing** (`src/billing/`) — hosted only, plan and payment; it never shows or edits limits and
  links to Usage. See docs/billing.md.

### Granting operator

The bootstrap owner (`PASEO_BOOTSTRAP_OWNER_EMAIL`) is the first operator. Every other operator is
granted by one SQL statement — no UI, no env var, no invite flow:

```sql
update "user" set is_instance_operator = true where lower(email) = lower('someone@example.com');
```

## Denials

One error, `EntitlementDenied` (`src/entitlements/catalog.ts:213`), covers caps, meters, and
flags. It maps to one wire shape, `EntitlementDenialPayload`
(`src/entitlements/denial.ts`), at exactly two boundaries: the org-access HTTP layer (409 via
`entitlementDenialResponse`) and a durable run's `failure_reason`
(`encodeEntitlementDenialFailureReason`/`decodeEntitlementDenialFailureReason`). Nothing catches
and reshapes a denial per call site.

## Fail closed

Enforcement must fail closed. An early version threaded `EntitlementsService` as an optional
dependency; `entitlements?.requireHeadroom(...)` silently skipped the seat check whenever it was
absent, so a piece of the composition root that forgot to wire it quietly disabled a limit
instead of erroring. Fixed by making it required end-to-end, including into `AuthServer` — there
is no code path today where an enforcement point can run without it.

## Schema evolution

Stored `granted` documents and audit snapshots predate fields the schema added later — `meters`
shipped after `seats`/`canInviteMembers`, with nothing migrating existing rows. The fix is not a
migration: `normalizeStoredEntitlements` (`src/entitlements/catalog.ts:61`) is the single point
every stored document passes through on read. It parses leniently, fills in the default a later
schema version introduced, then commits to the current strict shape. Adding a required field
costs one default in that function, not a backfill job. This shipped as a bug twice — once for
the entitlements table itself, once for meters — before landing here structurally; a future field
should extend this function, not add a migration.

## Self-hosted default

`provisionOrganization` (`src/organizations/provisioning.ts:37`) stamps whatever
`ProvisioningEntitlement` its caller resolves. Self-hosted always resolves to
`UNLIMITED_PROVISIONING`/`UNLIMITED_TEMPLATE` (`src/organizations/provisioning.ts:32`,
`src/entitlements/catalog.ts:119`) — no billing means no limits. A hosted instance passes a
resolver that stamps the Free plan instead; see docs/billing.md.

## Explicitly out of scope

Entitlements are keyed to `organization_id` only. Per-project or per-user entitlements would be a
new `project_entitlements` table, not a widening of this one.
