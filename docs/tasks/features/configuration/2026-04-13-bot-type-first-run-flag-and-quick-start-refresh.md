# Bot Type First-Run Flag And Quick Start Refresh

## Summary

Replace the public bootstrap CLI surface with a single operator-facing flag:

```bash
clisbot start --cli codex --bot-type personal
```

and keep the same shape across:

```bash
clisbot agents add default --cli codex --bot-type personal
clisbot agents bootstrap default --bot-type personal
```

## Status

Done

## Why

`--bootstrap personal-assistant` and `--mode team-assistant` leak internal naming into the CLI surface.

The public surface should optimize for:

- fast comprehension on first run
- one flag name across all bootstrap entry points
- wording that matches the product choice the operator is actually making
- quick-start docs that lead with Telegram plus inline token input
- a clear `--persist` upgrade path so later runs can use plain `clisbot start`

## Scope

- use `--bot-type <personal|team>` for `clisbot start`, `clisbot init`, `clisbot agents add`, and `clisbot agents bootstrap`
- map `personal` to internal bootstrap mode `personal-assistant`
- map `team` to internal bootstrap mode `team-assistant`
- reject legacy `--bootstrap` and `--mode` flags instead of keeping compatibility aliases
- update first-run warnings, help text, runtime summaries, README, and user-guide examples
- move README quick-start emphasis to Telegram-first plus `--persist`
- keep env-backed setup documented, but lower in prominence than inline-token quick start
- add regression coverage for the new parser and help text

## Non-Goals

- renaming internal bootstrap modes
- changing persisted internal bootstrap mode values
- renaming bootstrap templates or workspace file contracts

## Implementation Notes

- `src/control/commands/channel-bootstrap-flags.ts` normalizes `--bot-type personal|team` into the existing internal bootstrap modes and rejects legacy aliases.
- `src/control/commands/agents-cli.ts` uses the same `--bot-type` parser so `start`, `init`, `agents add`, and `agents bootstrap` share one contract.
- `src/main.ts`, `src/control/runtime/runtime-summary.ts`, and `src/control/commands/startup-bootstrap.ts` present only `--bot-type` in operator guidance.
- visible quick-start docs now lead with:
  - Telegram first
  - inline token first
  - `--persist` as the recommended path when the operator wants later plain `clisbot start`
- env-backed setup remains documented in channel-account docs instead of dominating the main onboarding path.

## Exit Criteria

- `clisbot start --cli codex --bot-type personal --telegram-bot-token ...` works
- `clisbot init --cli claude --bot-type team ...` works
- `clisbot agents add default --cli codex --bot-type personal` works
- `clisbot agents bootstrap default --bot-type team --force` works
- help, status, README, and user guide no longer tell operators to use `--bootstrap` or `--mode`
- tests cover canonical `--bot-type` parsing and legacy flag rejection
