# Grant scope: own or all

Status: **proposed** 2026-10-06, not built. First consumer:
[Schedules that belong to a conversation](../../audits/2026-10-06-conversation-schedules.md).

## Problem

A grant says who (Member, Team, Guest), where (Organization, Host, Project,
Team, Connection, Automation), what (privileges) and with which configuration
(constraints: `conversation`, `agentConfigurations`, `terminalProfiles`,
`projectFolders`; `hub/src/access/contract.ts:161`). It cannot say **whose**:
nothing separates "what I created" from "what someone else created".

The gap has already shown up more than once:

- A Developer creates worktrees but cannot archive even their own
  ([Later phases](README.md#later-phases), Developer cleanup).
- A Project creator gets no grant on only what they created
  ([Project creation](terminal-and-project-creation.md#project-creation)).
- Schedules: a Member who may manage schedules should change their own without
  being able to stop a teammate's.

The creator is already recorded in places (`SessionActor` on sessions,
`createdBy` on Terminal launches, `managed-access/terminal-launches.ts:11`);
authorization does not use it.

## Decision

A grant constraint `scope: "own" | "all"`.

```ts
// AccessConstraintsSchema, beside the existing constraints
scope: z.enum(["own", "all"]).optional(),
```

- **What it limits**: changing a resource (update, pause, resume, run, archive,
  delete) under the row's manage-type privileges. Seeing and creating are not
  limited.
- **Own**: the resource's `createdBy` is the caller's principal. A resource
  without a recorded creator counts as someone else's.
- **Absent means `all`.** Rows written before the constraint existed keep what
  they grant; adding the constraint never narrows an existing principal.
- **Union**: when several grants carry the same privilege, `all` wins over
  `own`. A Project row cannot narrow a Host row, as for every other constraint.
- **Owner, daemon admins, clients without Managed Access**: `all`.
- **Only privileges that opt in honor it.** A privilege honors scope once its
  resource records a creator. First: `automation.manage` (schedules). Next
  candidates: `workspace.manage` for archiving one's own worktrees, Bots,
  Terminal launches.

### To the daemon

The lease gains an optional per-Project, per-privilege scope beside
`projects[].privileges` (`hub/src/access/store.ts:1343`). The daemon permission
names stay upstream's; the managed-access authorizer compares the scope with the
resource's `createdBy` before it lets a change through. A daemon that does not
read the field treats the grant as `all`, which is today's behavior.

### In the app

The Access form shows the choice under a manage-type privilege that honors it:
**Applies to: Their own / All**. Default for a new grant: All, so the form does
not quietly narrow what an admin expects to grant.

### Naming

"Access scopes" in [permissions](../../permissions.md#access-scopes) is the
_where_ of a grant (Host versus Project). This `scope` is the _whose_. The
glossary entry must say both, and UI copy uses "Applies to", never "scope".

## Not covered

Channels. Who may act in a conversation is decided by the Route's Rules, never
by a sender's grants
([2026-09-18 chat authority](../../audits/2026-09-18-channel-chat-authority-and-limits.md));
a channel's own/anyone split is the creator versus the Connection Admin.

## Options considered

| Option                                                    | Why not                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A second privilege per resource (`*.others`)              | Multiplies privileges by resource kind.                                              |
| An implicit rule: whoever may create may change their own | Admins could not grant "only their own" to someone who also has a broader privilege. |
| `ownership: "own" \| "any"`                               | Reads as Organization Owner.                                                         |
| `creator: "self" \| "anyone"`                             | Considered; `scope: own \| all` chosen 2026-10-06.                                   |
| A boolean (`manageOthers`)                                | Two states only; no room for a later "their Team's".                                 |
