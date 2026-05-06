# clisbot Update Guide

Use this after the [migration index](../migrations/index.md) says whether manual action is required.

`clisbot update` and `clisbot update --help` currently print guidance only. They do not install packages yet.
A bot can use this guide to update itself.

## Decision

```text
stable/latest/default -> npm dist-tag latest
beta                  -> npm dist-tag beta
exact version         -> version named by the user
manual action default -> none
```

Use npm dist-tags, not highest semver. Use beta only when the user asks.

## Flow

```text
clisbot status
npm install -g clisbot@<target> && clisbot restart
clisbot status
report version, health, manual action, and useful release highlights
```

## Wrong Publish Recovery

If a version was published by mistake:

1. publish the corrected target or tag first so npm points users at the right build
2. deprecate the wrong version after that
3. start with `npm login` in an attached session
4. if npm returns a browser approval URL, keep that same session open and continue it after approval
5. do not switch to `--otp`; keep the normal browser or interactive approval flow and stop if that flow cannot complete

Example:

```text
npm deprecate clisbot@0.1.46-beta.1 "Published by mistake. Use clisbot@0.1.50-beta.10 instead."
```

## Release Reading

Read these when the user asks what is new, what to try, or what to watch:

- [Release notes](../releases/README.md)
- [v0.1.52 release note](../releases/v0.1.52.md)
- [v0.1.51 release note](../releases/v0.1.51.md)
- [Release guides](README.md)
- [v0.1.52 release guide](releases/v0.1.52-release-guide.md)
- [v0.1.51 release guide](releases/v0.1.51-release-guide.md)
- [User guide](../user-guide/README.md)

Use [Release notes](../releases/README.md) for the canonical version map.
Use [Release guides](README.md) for shorter catch-up summaries.
For deeper questions that the migration index, update guide, and release docs do not answer, inspect the full [docs folder](https://github.com/longbkit/clisbot/tree/main/docs), including `docs/user-guide/`. If the local docs are not available, fetch or clone the GitHub docs and read the relevant files before answering.

## Current Stable Path

```text
Path: any version before 0.1.52 -> 0.1.52
Target: clisbot@0.1.52
Update path: direct
Manual action: none
Risk: low
Automatic config update: yes for installs before 0.1.50; 0.1.52 adds no new schema migration and may also rewrite current-schema configs if stale short startup-delay overrides are detected
Breaking change: no
Command: npm install -g clisbot@0.1.52 && clisbot restart
Verify: clisbot status
Release note: ../releases/v0.1.52.md
Release guide: releases/v0.1.52-release-guide.md
```

This includes released `0.1.43` installs, older legacy installs before `0.1.43`, internal `0.1.44` pre-release installs, and current `0.1.50` or `0.1.51` installs that only need the package bump while also picking up stale-startup-delay cleanup when old short overrides are still pinned in config.
