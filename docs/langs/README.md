# Localized Docs

## Purpose

Use `docs/langs/` as the multilingual entry layer for `clisbot`.

This area is for:

- localized mirror docs
- localized root README mirrors
- localized folder landing pages that mirror real `docs/.../README.md` files
- language-specific glossary ownership
- translation status tracking
- easier discovery of the right English source docs when a deep page is not yet localized

## Navigation Model

Use one role per file type so the structure stays obvious:

| Path shape | Role |
| --- | --- |
| `docs/langs/README.md` | Global multilingual hub |
| `docs/langs/root/README.<lang>.md` | Localized mirror of the root repo `README.md` |
| `docs/langs/<language>/<source-folder>/README.md` | Localized mirror of `docs/<source-folder>/README.md` when that source file exists |
| `docs/langs/<language>/<source-folder>/<child>.md` | Localized mirror of a real child doc under `docs/<source-folder>/` when that translation exists |
| `docs/langs/<language>/_translations/glossary.md` | Terminology ownership for that language |
| `docs/langs/<language>/_translations/status.md` | Coverage truth, translation priority, and review tracking for that language |

## Current Languages

- [English](../../README.md)
- [Tiếng Việt](root/README.vi.md)
- [简体中文](root/README.zh-CN.md)
- [한국어](root/README.ko.md)

Current rollout priority:

1. Vietnamese
2. Simplified Chinese
3. Korean

## Structure

```text
docs/langs/
  README.md
  root/
    README.vi.md
    README.zh-CN.md
    README.ko.md
  vi/
    _translations/
      glossary.md
      status.md
    architecture/
    features/
    migrations/
    overview/
    releases/
    updates/
    user-guide/
  zh-CN/
    _translations/
      glossary.md
      status.md
    ...
  ko/
    _translations/
      glossary.md
      status.md
    ...
```

## Translation Policy

- English remains the canonical source of truth for product behavior and operator contracts.
- Each localized README should put the English link first so readers can jump back quickly.
- `docs/langs/root/README.<lang>.md` maps to the root repo `README.md`. Treat it as the localized repo README, not as an invented shortcut layer.
- `docs/langs/<language>/...` should mirror the real `docs/...` tree only. Do not invent extra per-language `README.md` files at the language-root level.
- A localized folder is not "done" just because its `README.md` exists. Track coverage file by file against the real source tree.
- Use the language glossary in `_translations/glossary.md` as the preferred wording source for repeated product terms.
- Treat `_translations/glossary.md` as wording ownership and `_translations/status.md` as coverage ownership for that language.
- `_translations/glossary.md` is a translation wording owner only. Architecture language ownership lives separately in `docs/architecture/domain-language.md`.
- Keep localized landing pages natural and readable for native speakers; do not echo prompt wording or awkward literal translation.
- When a source document does not have a localized counterpart yet, link the English original clearly instead of pretending the localized version is complete.
- When only a landing page is localized, say that explicitly so readers do not assume the child docs are already mirrored in that language.

## Recommended Reading Path

- Start with the localized repo README for your language.
- Move from there into the localized folder landing pages for `architecture`, `features`, `migrations`, `overview`, `releases`, `updates`, and `user-guide`.
- Use each language's `_translations/status.md` to see exact file coverage, pending gaps, and review status.
