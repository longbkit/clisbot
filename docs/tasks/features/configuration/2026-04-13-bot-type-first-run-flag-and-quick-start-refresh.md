# Bot Type First-Run Flag And Quick Start Refresh

## Summary

Replace the public first-run `start` and `init` surface from:

```bash
clisbot start --cli codex --bootstrap personal-assistant
```

to:

```bash
clisbot start --cli codex --bot-type personal
```

while keeping `--bootstrap` as a backward-compatible parser alias for existing scripts.

## Status

Done

## Why

`--bootstrap personal-assistant` is accurate internally but heavier than necessary for first-run operators.

The public surface should optimize for:

- fast comprehension on first run
- wording that matches the product choice the operator is actually making
- quick-start docs that lead with Telegram plus inline token input
- a clear `--persist` upgrade path so later runs can use plain `clisbot start`

## Scope

- add `--bot-type <personal|team>` for `clisbot start` and `clisbot init`
- map `personal` to internal bootstrap mode `personal-assistant`
- map `team` to internal bootstrap mode `team-assistant`
- keep `--bootstrap` working as a compatibility alias without documenting it on `start` or `init`
- update first-run warnings, help text, runtime summaries, README, and user-guide examples
- move README quick-start emphasis to Telegram-first plus `--persist`
- keep env-backed setup documented, but lower in prominence than inline-token quick start
- add regression coverage for the new parser and help text

## Non-Goals

- renaming internal bootstrap modes
- changing `clisbot agents add --bootstrap ...`
- changing `clisbot agents bootstrap --mode ...`
- removing backward compatibility for existing automation that still uses `--bootstrap`

## Implementation Notes

- `src/control/channel-bootstrap-flags.ts` is the only new translation layer; it normalizes `--bot-type` and legacy `--bootstrap` into the existing internal bootstrap modes.
- `src/main.ts`, `src/control/runtime-summary.ts`, and `src/control/startup-bootstrap.ts` now present only `--bot-type` in first-run guidance.
- visible quick-start docs now lead with:
  - Telegram first
  - inline token first
  - `--persist` as the recommended path when the operator wants later plain `clisbot start`
- env-backed setup remains documented in channel-account docs instead of dominating the main onboarding path.

## Exit Criteria

- `clisbot start --cli codex --bot-type personal --telegram-bot-token ...` works
- `clisbot init --cli claude --bot-type team ...` works
- first-run help and status no longer tell operators to use `start --bootstrap ...`
- README and user guide use `--bot-type` for `start` and `init`
- tests cover canonical `--bot-type` parsing and backward-compatible `--bootstrap` alias handling
