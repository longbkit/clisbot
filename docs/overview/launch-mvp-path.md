# Launch MVP Path

## Purpose

This document makes the current launch order explicit.

Use it as the short roadmap lens for:

- community readers
- product prioritization
- backlog review

Detailed execution still belongs in the linked task docs.

## Launch Principles

- keep the product configurable across multiple layers or surfaces, but always ship clear defaults
- keep status and debug surfaces truthful enough that operators can see which layer is active
- keep first-run startup friction extremely low
- keep stability and runtime truthfulness as launch gates, not later polish
- treat naming, config shape, and user-facing surface clarity as part of product quality

## Snapshot

1. Foundations first:
   - frictionless startup and credential persistence
   - runtime stability and truthful status or debug surfaces
   - `/loop` as the current differentiating workflow feature
2. International launch gate:
   - Claude, Codex, and Gemini CLI all supported and well tested
   - current shared channel package stays Slack plus Telegram
3. Vietnam launch package:
   - keep the same CLI trio
   - add Zalo Official Account plus Zalo Personal
4. Next expansion wave:
   - add more channels such as Discord, WhatsApp, Google Workspace, and Microsoft Teams
   - add more agentic CLIs such as Cursor, Amp, OpenCode, Qwen, Kilo, and Minimax based on real userbase demand
5. Open launch decision:
   - decide whether native CLI slash-command compatibility, override, and customization must ship before broader public push

## Phase 0: Foundations

These are not optional polish items.

They are launch gates:

- fast start without forcing env setup first
- durable credential persistence after first success
- stable runner and channel truthfulness
- operator-visible status for credential source, route state, and runtime health
- `/loop` as the current killer feature for recurring or scheduled work

## Phase 1: International Core Launch

The first broad launch target should prove one common CLI trio:

- Claude
- Codex
- Gemini

Definition of done for this phase:

- each CLI works through the existing Slack and Telegram package
- each CLI has enough setup, runtime, and interruption validation to be trustworthy
- docs and status surfaces make CLI-specific caveats obvious

Later CLI support should not dilute this first gate.

## Phase 2: Vietnam Launch Package

For Vietnam, the product package should extend the same core trio with:

- Zalo Official Account
- Zalo Personal

This is a channel-package milestone, not a different product direction.

## Phase 3: Post-Core Expansion

After the core trio is proven:

- expand CLI support based on actual userbase demand
- prioritize Cursor, Amp, OpenCode, Qwen, Kilo, and Minimax only after collecting a demand snapshot
- avoid treating every possible CLI as equal-priority launch work

After the channel package for Slack, Telegram, and Vietnam-specific Zalo is settled:

- expand to Discord
- expand to WhatsApp
- expand to Google Workspace
- expand to Microsoft Teams

## Native Slash Commands

This remains an explicit launch-shaping decision.

The system already supports clisbot-owned slash commands and native pass-through fallback.

The open question is whether broader public launch should also include:

- per-CLI native slash-command compatibility notes
- reserved-command conflict handling
- override or rename surfaces
- operator or user customization for conflicting command prefixes

## Backlog Links

- [Common CLI Launch Coverage And Validation](../tasks/features/runners/2026-04-13-common-cli-launch-coverage-and-validation.md)
- [Vietnam Channel Launch Package](../tasks/features/channels/2026-04-13-vietnam-channel-launch-package.md)
- [Secondary CLI Expansion Prioritization](../tasks/features/runners/2026-04-13-secondary-cli-expansion-prioritization.md)
- [Post-MVP Channel Expansion Wave](../tasks/features/channels/2026-04-13-post-mvp-channel-expansion-wave.md)
- [Native Slash Command Compatibility And Overrides](../tasks/features/agents/2026-04-13-native-slash-command-compatibility-and-overrides.md)
