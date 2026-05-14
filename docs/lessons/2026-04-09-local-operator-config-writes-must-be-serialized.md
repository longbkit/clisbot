---
title: Local Operator Config Writes Must Be Serialized
date: 2026-04-09
area: control, configuration, reliability
summary: Operator CLI commands that mutate local config must behave as a single-writer path, because parallel writes can corrupt the runtime config file.
related:
  - docs/features/configuration/README.md
  - docs/features/control/README.md
  - src/config/core/config-file.ts
  - src/control/commands/channel-privilege-cli.ts
  - src/control/commands/channels-cli.ts
---

## Context

This lesson comes from local runtime testing in the `clisbot` project on April 9, 2026.

While validating Slack privilege-command flows, two operator CLI mutations were run in parallel against `~/.clisbot/clisbot.json`.

That corrupted the local config file and had to be repaired manually before runtime testing could continue.

This was not just an operator mistake. It exposed that the current mutation path does not protect config writes as a shared resource.

## Lesson

Local operator config should be treated as a single-writer state transition.

If multiple CLI commands can update the same config file, the write path must guarantee:

- one coherent read-modify-write cycle at a time
- atomic replacement of the final file
- no partial or interleaved writes

Without that, simple operator automation or parallel CLI use can break the runtime in ways that look unrelated to the original command.

## Practical Rule

For any new config mutation command:

1. route the mutation through one shared write path
2. serialize competing writers with locking or an equivalent guard
3. write the new content atomically
4. test at least one concurrent-write case for the shared path
5. treat manual repair of corrupted config as a reliability bug, not an acceptable operator burden

## Applied Here

This lesson is only partially applied today.

The immediate runtime was repaired manually so validation could continue, but the product still needs a hardened shared config-write path and concurrency coverage in tests.
