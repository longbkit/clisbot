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
report version, health, manual action, and useful release-note highlights
```

## Release Usage Docs

Read these only when the user asks what is new, what to try, or what to watch:

- [Release notes](../releases/README.md)
- [v0.1.45 release note](../releases/v0.1.45.md)
- [User guide](../user-guide/README.md)

Use [Release notes](../releases/README.md) as quick release info. For deeper questions that the migration index, update guide, and release notes do not answer, inspect the full [docs folder](https://github.com/longbkit/clisbot/tree/main/docs), including `docs/user-guide/`. If the local docs are not available, fetch or clone the GitHub docs and read the relevant files before answering.

## Current Stable Path

```text
Path: any version before 0.1.45 -> 0.1.45
Target: clisbot@0.1.45
Update path: direct
Manual action: none
Risk: low
Automatic config update: yes
Breaking change: no
Command: npm install -g clisbot@0.1.45 && clisbot restart
Verify: clisbot status
Release note: ../releases/v0.1.45.md
```

This includes released `0.1.43` installs, older legacy installs before `0.1.43`, and internal `0.1.44` pre-release installs.
