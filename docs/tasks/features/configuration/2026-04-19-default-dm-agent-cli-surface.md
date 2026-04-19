# Default DM Agent CLI Surface

## Summary

Add a first-class `clisbot bots ...` surface to inspect, set, and clear the default direct-message fallback agent for a bot without forcing operators to:

- materialize `dm:*` as a bot-level route first
- edit `~/.clisbot/clisbot.json` by hand
- reverse-engineer whether the effective DM agent comes from bot defaults, a materialized route override, or the bot fallback agent

## Status

Planned

## Why

Current behavior exposes a product seam that is easy to trip over:

- `clisbot bots set-agent --channel slack --bot default --agent claude` changes the bot fallback agent
- a default DM override may still live at `bots.<channel>.defaults.directMessages["dm:*"].agentId`
- `clisbot routes clear-agent --channel slack dm:* --bot default` only works after a bot-level `dm:*` route exists
- if the operator never materialized `dm:*`, the CLI says `Unknown route`, even though an effective DM override still exists in defaults

That makes a common operator intent awkward:

- “make Slack DM use Claude too”
- “clear the DM-specific override and go back to the bot fallback agent”

In practice this pushed the live operator flow toward direct config edits, which is exactly the gap this task should close.

## Scope

- add a bot-level CLI surface for DM default agent control
- support both `slack` and `telegram`
- make the surface target the defaults layer directly:
  - `bots.<channel>.defaults.directMessages["dm:*"].agentId`
- keep route-level `dm:*` commands as the materialized-route surface only
- document the difference between:
  - bot fallback agent
  - DM default agent override
  - bot-level materialized `dm:*` route override
- make operator output truthful when no DM default agent override is present

## Proposed Command Shape

```bash
clisbot bots get-dm-agent --channel <slack|telegram> [--bot <id>]
clisbot bots set-dm-agent --channel <slack|telegram> [--bot <id>] --agent <id>
clisbot bots clear-dm-agent --channel <slack|telegram> [--bot <id>]
```

## Product Rules

- `get-dm-agent` reads the effective value stored on the defaults-layer `dm:*` node for the selected provider
- `set-dm-agent` creates the defaults-layer `dm:*` node if needed, then writes `agentId`
- `clear-dm-agent` removes only the defaults-layer `agentId`, not the full DM policy node
- route commands keep their current meaning:
  - they operate on materialized bot-level routes only
  - they should not silently mutate provider defaults

## Non-Goals

- merging route CLI and bot defaults CLI into one implicit magic surface
- hiding whether an override comes from defaults or from a materialized route
- changing the current route-resolution order in this task

## Exit Criteria

- an operator can change Slack or Telegram DM fallback agent selection without editing config manually
- an operator can clear the DM default agent override with one obvious command
- CLI help and user guide make the defaults-vs-route distinction easy to understand
- regression coverage proves the commands mutate only the intended config layer

## Related Docs

- [CLI Commands](../../../user-guide/cli-commands.md)
- [Bots And Credentials](../../../user-guide/bots-and-credentials.md)
- [Target Config And CLI Mental Model Migration](2026-04-18-target-config-and-cli-mental-model-migration.md)
