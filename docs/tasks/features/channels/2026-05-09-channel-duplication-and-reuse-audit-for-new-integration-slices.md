# Channel Duplication And Reuse Audit For New Integration Slices

## Summary

Audit the current channel integration surface for duplication that still appears when adding a new channel, then split the findings into concrete reuse or standardization follow-ups with low blast radius.

## Status

Planned

## Why

Recent `zalo-bot` work exposed several places where adding a new channel still pushes implementation toward copy-paste instead of reuse.

Known hotspots already include examples such as:

- route config resolution
- pairing access matcher logic
- behavior-config target binding
- processing indicator adapter paths
- closed-set channel dispatch branches
- prompt-envelope surface hints

Some of those duplications are justified by true provider differences.
Some are not.

Without one explicit audit, the product risks drifting into:

- "plugin seam exists, but real channel work still copies internal slices"
- inconsistent extension patterns
- higher review cost whenever a new provider is added

## Scope

- inventory channel-integration hotspots that duplicated during Slack, Telegram, and Zalo Bot work
- distinguish justified provider ownership from accidental duplication
- identify the smallest stable seam for each hotspot
- group follow-up work into low-blast-radius standardization tasks instead of one large refactor
- explicitly include route-config reuse as one of the audit targets

## Non-Goals

- one-shot rewrite of all channel internals
- forcing OA or personal Zalo paths into the official `zalo-bot` provider shape
- flattening real platform differences just to make code look generic

## Audit Targets

Review at least these slices:

- route config resolution and admission logic
- pairing access normalization and matcher logic
- behavior-config target binding
- processing indicator adapters and typing or decoration lifecycle
- prompt-envelope surface hints
- channel-specific dispatch readability and closed-set branching
- message action or transport seams where the same control flow keeps reappearing

## Suggested Output

The audit should produce:

- one compact matrix of hotspots
- whether each hotspot is:
  - already shared enough
  - should be standardized now
  - should stay provider-owned
  - should be deferred intentionally
- follow-up task links for each chosen standardization slice

## Validation Notes

The audit is successful when it reduces ambiguity about:

- where future channel work should plug in
- which channel differences are intentional
- which repeated code should stop being repeated

## Exit Criteria

- duplication hotspots are named explicitly
- route-config duplication is assessed alongside the other slices
- the next channel integration does not need to rediscover these reuse boundaries from scratch
- resulting follow-up tasks are small enough to execute independently

## Related Docs

- [Channel Plugin Standardization](2026-04-10-channel-plugin-standardization.md)
- [Channel Processing Indicator Adapter Standardization](2026-05-09-channel-processing-indicator-adapter-standardization.md)
- [Channel Behavior Config Target Binding Standardization](2026-05-09-channel-behavior-config-target-binding-standardization.md)
- [Pairing Access Matcher Standardization Across Channels](../auth/2026-05-09-pairing-access-matcher-standardization-across-channels.md)
