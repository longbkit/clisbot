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
5. if the write command still returns `EOTP`, ask the operator for a current OTP and rerun the exact command with `--otp=<code>`

Example:

```text
npm deprecate clisbot@0.1.46-beta.1 "Published by mistake. Use clisbot@0.1.45-beta.9 instead." --otp=<code>
```

## Release Reading

Read these when the user asks what is new, what to try, or what to watch:

- [Release notes](../releases/README.md)
- [v0.1.45 release note](../releases/v0.1.45.md)
- [Release guides](README.md)
- [v0.1.45 release guide](releases/v0.1.45-release-guide.md)
- [User guide](../user-guide/README.md)

Use [Release notes](../releases/README.md) for the canonical version map.
Use [Release guides](README.md) for shorter catch-up summaries.
For deeper questions that the migration index, update guide, and release docs do not answer, inspect the full [docs folder](https://github.com/longbkit/clisbot/tree/main/docs), including `docs/user-guide/`. If the local docs are not available, fetch or clone the GitHub docs and read the relevant files before answering.

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
Release guide: releases/v0.1.45-release-guide.md
```

This includes released `0.1.43` installs, older legacy installs before `0.1.43`, and internal `0.1.44` pre-release installs.
