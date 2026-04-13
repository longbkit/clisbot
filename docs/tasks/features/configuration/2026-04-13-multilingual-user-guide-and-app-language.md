# Multilingual User Guide And App Language

## Summary

Add first-class multilingual support for both:

- public and operator-facing user-guide docs
- app-owned user-facing text surfaces inside `clisbot`

Initial target languages:

- English
- Vietnamese (`vi`)
- Simplified Chinese (`zh`)
- Korean (`ko`)

The first product entry should let operators choose language at startup:

```bash
clisbot start --lang vi
clisbot start --lang zh
clisbot start --lang ko
```

This should reduce setup friction and make the app more accessible in the first target markets.

## Status

Planned

## Why

Today the docs and app-owned text are effectively English-only.

That increases onboarding friction for non-English-first users even when the underlying bot behavior is already useful.

This feature should treat language as a real product surface, not just a docs translation afterthought.

## Scope

- add one app-level language selection surface through `clisbot start --lang <code>`
- persist the chosen app language in config
- let app-owned text render in the selected language for:
  - startup guidance
  - pairing guidance
  - status output
  - help output
  - operator remediation hints
  - other clisbot-owned chat replies where the system, not the agent, is speaking
- define multilingual support for control slash commands and related help text
- add multilingual user-guide entry docs for:
  - English
  - Vietnamese
  - Simplified Chinese
  - Korean
- document the translation ownership model so updates do not drift silently

## Non-Goals

- translating arbitrary agent model output
- building a full runtime locale negotiation system in phase 1
- supporting every language before launch
- forcing every config field name or CLI flag itself to be localized

## Product Decisions To Make Explicit

- `--lang` should control app-owned language, not the agent model language
- config should store the chosen language explicitly
- English should remain the safe fallback when a translation key is missing
- multilingual support should cover both shell output and in-channel clisbot-owned replies
- user-guide localization should have one obvious entry point instead of scattered translated fragments

## Slash Command Direction

This task should make one explicit product decision for control slash commands:

1. English commands stay canonical and only descriptions or help text are localized
2. localized aliases are added for selected control commands
3. both are supported, with conflict rules documented

Current recommendation:

- keep English commands canonical
- localize help text and app replies first
- evaluate localized aliases only where they clearly reduce friction without creating command conflicts

If localized aliases are added later, they should integrate cleanly with the native slash-command compatibility work.

## Suggested Config Shape

```json
{
  "app": {
    "language": "vi"
  }
}
```

Future extension if needed:

```json
{
  "app": {
    "language": "vi",
    "fallbackLanguage": "en"
  }
}
```

## Delivery Slices

### 1. Language model and config

- define supported language codes
- add `--lang` on `start`
- persist the chosen language in config
- define default and fallback rules

### 2. App-owned text catalog

- extract clisbot-owned strings into a translation catalog
- cover startup, help, status, pairing, and remediation text first
- fail safely to English when keys are missing

### 3. Channel and slash-command surfaces

- localize clisbot-owned command help and route guidance
- decide canonical versus alias behavior for control slash commands
- keep native agent slash-command forwarding semantics clear

### 4. User-guide localization

- create one multilingual user-guide entry strategy
- add initial translated guides for `vi`, `zh`, and `ko`
- define update rules so translated docs stay in sync with source docs

## Exit Criteria

- operators can choose `--lang vi|zh|ko|en` on startup
- the chosen app language is visible in config and reflected in app-owned text
- user-guide has clear multilingual entry points for the first target languages
- slash-command language behavior is documented clearly enough to avoid confusion
- missing translations fall back safely instead of breaking startup or chat guidance

## Related Docs

- [Launch MVP Path](../../../overview/launch-mvp-path.md)
- [Configuration Feature](../../../features/configuration/README.md)
- [User Guide](../../../user-guide/README.md)
- [Native Slash Command Compatibility And Overrides](../agents/2026-04-13-native-slash-command-compatibility-and-overrides.md)
