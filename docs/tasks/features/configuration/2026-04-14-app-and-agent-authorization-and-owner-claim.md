# App And Agent Authorization And Owner Claim

## Summary

Introduce one explicit auth model for app-level control and agent-level runtime behavior, plus a first-owner claim flow for fresh installs, while keeping the initial slice small enough to ship quickly.

## Status

Ready

## Outcome

After this task:

- `clisbot.json` can express `app.auth` and `agents.<id>.auth`
- app ownership can be claimed automatically only while the app has no owner
- routed users who are not explicitly listed still resolve to `member`
- route-local bash policy uses an explicit enum shape instead of `enabled + allowUsers[]`
- injected agent prompts receive truthful auth context for config mutation guidance
- channel slash-command handling can enforce the main agent-level permissions
- full CLI mutation enforcement remains a separate later task

## Why

The current model is too narrow:

- route privilege config only explains bash gating
- empty allowlists still carry overloaded semantics
- app ownership and agent ownership do not exist as first-class policy
- prompt guidance cannot explain who is actually allowed to mutate `clisbot`
- there is no stable policy source for later CLI permission checks

This task introduces the minimum shared policy model that later slices can reuse.

## Scope

- add `app.auth` to persisted config
- add `agents.<id>.auth` to persisted config
- add `ownerClaimWindowMinutes`
- add `defaultRole`
- add `roles.<role>.allow`
- add `roles.<role>.users`
- change route `privilegeCommands` from `enabled + allowUsers` to `mode + users`
- resolve effective app role and agent role for the current sender
- inject prompt guidance based on resolved app or agent auth
- inject auth guidance through a protected prompt segment that template overrides cannot remove
- gate selected channel slash commands from agent auth
- define the phase-1 command-to-permission mapping for current routed slash actions
- update docs, help text, and tests

## Non-Goals

- hard enforcement for config-mutating `clisbot` CLI commands
- shell-level blocking of `clisbot` mutation commands inside the agent runner
- a separate principal registry
- channel-first admin scopes
- full migration from route-local policy to agent auth for every action in one slice
- backward-compatible loading of legacy `privilegeCommands.enabled` or `privilegeCommands.allowUsers` keys
- writing the full end-user operator guide for role management

## Affected Surfaces

### 1. Prompt Context

Phase 1 should pass auth truth into the injected prompt so the agent sees at least:

- current app role
- current agent role
- whether config mutation is allowed
- whether `clisbot` mutation CLI commands are allowed

This guidance is advisory, but it should be precise enough to reduce accidental config mutation by non-owners.

Implementation rule:

- the auth block should be appended from a protected system-owned or developer-owned prompt layer after normal template resolution
- operator-editable prompt templates may change general wording, but they should not be able to delete or weaken the auth facts
- the block should explicitly instruct the agent to refuse unauthorized requests to edit `clisbot.json`, mutate auth roles, or run config-mutating `clisbot` commands

### 2. Channel Slash Commands

Phase 1 should enforce agent permissions in `src/channels/interaction-processing.ts` for the main routed control actions, especially:

- transcript and observe actions
- interrupt and nudge
- bash
- follow-up mode changes
- streaming or response-mode changes
- queue and loop controls

### 3. Later Control CLI Enforcement

App-level owner or admin checks for config-mutating `clisbot` CLI commands should stay out of this slice and move to a later control-owned task.

## Product Rules

- `app.auth.roles.owner.users` is the canonical owner source of truth
- if the owner list is empty at runtime start, claim stays open for `ownerClaimWindowMinutes`
- the first successful DM user during that window is added to `owner.users`
- once an owner exists, later restarts do not reopen claim
- if operators remove every owner later, the next start opens claim again
- a user not listed in an agent role resolves to `agents.<id>.auth.defaultRole`
- phase 1 should use `member` as the normal default role
- pairing or route admission still decides whether the user reaches the bot at all
- agent auth only decides what the user may do after that
- app `owner` should satisfy every app-level permission
- phase 1 should also treat app `owner` as implicitly allowed for every agent-level permission

## Implementation Notes

- `src/config/schema.ts` owns the new persisted shape
- `src/config/template.ts` should seed the new auth blocks
- startup and DM-pairing flow should own the owner-claim behavior
- one shared auth resolver should map sender identity to app role and agent role
- `src/channels/agent-prompt.ts` should render auth context into the prompt
- `src/channels/interaction-processing.ts` should enforce the selected agent permissions
- the implementation should keep one explicit mapping table between current slash commands and the new permission names
- route `privilegeCommands` should move to:
  - `mode: "disabled" | "all" | "allowlist"`
  - `users: string[]`
- config loading should reject legacy `privilegeCommands.enabled` and `privilegeCommands.allowUsers` with a clear rewrite message
- effective bash permission should still respect both:
  - agent auth
  - route-local override

## Suggested Validation

- `bun x tsc --noEmit`
- targeted config-schema tests
- targeted startup or pairing tests for owner claim
- targeted interaction-processing tests for slash-command auth
- targeted prompt-rendering tests for auth context
- targeted schema validation tests that legacy `privilegeCommands.enabled` and `allowUsers` now fail clearly
- full `bun test`

## Regression Risks To Test

- a non-owner tries to induce config mutation through normal chat, steering, or loop prompt paths
- owner claim is attempted from a non-DM context and must not succeed
- `member` can still do the intended low-friction actions, but cannot reach `bash`, transcript, or observe unless granted
- app `owner` still satisfies agent-level permission checks in phase 1
- route-local `privilegeCommands.mode` still narrows `bash` access even when the role grants `bash`
- a legacy config using `enabled + allowUsers` fails fast instead of being interpreted ambiguously

## Exit Criteria

- config supports `app.auth` and `agents.<id>.auth`
- owner claim opens only while the owner list is empty
- the first successful DM during claim becomes owner automatically
- non-listed routed users resolve to `member`
- route privilege config no longer uses implicit empty-list wildcard semantics
- injected prompt text includes truthful app or agent auth context
- selected channel slash commands are denied or allowed from resolved agent permissions
- legacy `privilegeCommands.enabled` and `allowUsers` keys fail with a clear rewrite error
- docs explain that prompt guidance ships now but hard CLI enforcement is still pending
- docs explain that a separate user-guide follow-up is still needed before the role model is end-user complete

## Related Docs

- [App And Agent Authorization And Owner Claim](../../../features/configuration/app-and-agent-authorization-and-owner-claim.md)
- [Auth-Aware CLI Mutation Enforcement And Runner Command Guardrails](../control/2026-04-14-auth-aware-cli-mutation-enforcement-and-runner-command-guardrails.md)
