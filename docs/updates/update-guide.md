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

## Scope

This guide is install/update only. Release, publish, and deprecation workflows
are outside this document; use the repo release workflow for those tasks.

## Release Reading

Read these when the user asks what is new, what to try, or what to watch:

- [Release notes](../releases/README.md)
- [Upcoming release note](../releases/upcoming.md)
- [v0.1.53 release note](../releases/v0.1.53.md)
- [v0.1.52 release note](../releases/v0.1.52.md)
- [v0.1.51 release note](../releases/v0.1.51.md)
- [Release guides](README.md)
- [v0.1.54-beta.1 release guide](releases/v0.1.54-beta.1-release-guide.md)
- [v0.1.53 release guide](releases/v0.1.53-release-guide.md)
- [v0.1.52 release guide](releases/v0.1.52-release-guide.md)
- [v0.1.51 release guide](releases/v0.1.51-release-guide.md)
- [User guide](../user-guide/README.md)

Use [Release notes](../releases/README.md) for the canonical version map.
Use [Release guides](README.md) for shorter catch-up summaries.
For deeper questions that the migration index, update guide, and release docs do not answer, inspect the full [docs folder](https://github.com/longbkit/clisbot/tree/main/docs), including `docs/user-guide/`. If the local docs are not available, fetch or clone the GitHub docs and read the relevant files before answering.

## Current Beta Path

```text
Path: 0.1.53 -> 0.1.54-beta.1
Target: clisbot@0.1.54-beta.1 or clisbot@beta
Update path: direct
Manual action: none
Risk: medium for API channel adopters; low for non-API-channel users
Automatic config update: no new schema migration in this beta
Breaking change: no
Command: npm install -g clisbot@beta && clisbot restart
Verify: clisbot status
Release note: ../releases/upcoming.md
Release guide: releases/v0.1.54-beta.1-release-guide.md
```

## Current Stable Path

```text
Path: any version before 0.1.53 -> 0.1.53
Target: clisbot@0.1.53
Update path: direct
Manual action: none
Risk: medium
Automatic config update: yes; configs before schema 0.1.53 are backed up and rewritten to add the new admin-only sensitive channel permissions
Breaking change: no
Command: npm install -g clisbot@0.1.53 && clisbot restart
Verify: clisbot status
Release note: ../releases/v0.1.53.md
Release guide: releases/v0.1.53-release-guide.md
```

This includes released `0.1.43` installs, older legacy installs before `0.1.43`, internal `0.1.44` pre-release installs, and current `0.1.50`, `0.1.51`, or `0.1.52` installs.
