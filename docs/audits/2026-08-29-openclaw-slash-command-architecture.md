# OpenClaw slash-command architecture

Date: 2026-08-29

Consolidated and extended into a full command vocabulary by
[Channel slash commands](../features/slash-commands/README.md) (spec) and its
[gap audit & implementation plan](../features/slash-commands/implementation-plan.md).
This audit remains the record of the shared-parser / per-channel-adapter boundary
those docs build on.

## Findings

OpenClaw defines command metadata in a shared registry. Built-ins, generated commands, and plugin commands contribute entries with names, aliases, arguments, descriptions, categories, and access requirements. The Gateway handles standalone text commands; supported providers also register native commands. Directives can be stripped from messages and applied inline, while local commands execute in the client or Gateway. Unknown commands produce a visible localized result.

Ingress adapters retain channel-specific work. They decide whether a native command is available, normalize provider mentions and entities, and enforce channel access and mention gates before the shared command behavior runs.

Hub already adopts the useful boundary: one shared command parser and command vocabulary, with Slack and Telegram adapters limited to native-event and mention normalization. Hub deliberately differs in these ways:

- Hub commands are in-conversation controls for a bound agent, not an app-level command registry.
- Slack accepts `\\` as a conflict-free alias when native slash commands are unavailable or reserved.
- Telegram bot mentions are normalized in the shared parser because group text commonly arrives with glued, spaced, or doubled addressing.
- Approval authority is exactly once: typed commands and native card callbacks converge on the same resolver and two authority checks.

## Recommendations

- Keep command metadata centralized if the command set grows; **applied** for the current shared parser and help text.
- Keep provider adapters responsible for native ingress and mention facts; **applied** in the existing vertical seams.
- Keep unknown commands inert in bound conversations; **applied** by whole-message matching and fallback to normal message handling.
- Add localized help only when Hub adds locale support; **not applied**, because the current Hub surface has one concise help string.
- Add native command registration only when a product surface needs it; **not applied**, because approval commands must work without per-app setup.
