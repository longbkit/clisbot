---
title: npm Release Flow Needs Explicit Publish Discipline
date: 2026-04-08
area: release, packaging, operations
summary: npm publishing should follow a strict sequence of version bump, validation, dry run, and real publish because scoped packages, OTP enforcement, and packaging mistakes can otherwise waste versions and operator time.
related:
  - package.json
  - README.md
  - docs/user-guide/README.md
---

## Context

This project hit multiple publish-specific problems in sequence:

- package naming constraints on npm
- scoped package setup requirements
- runtime packaging issues that only appeared after install
- OTP-gated publish failure on the real publish command

None of these were code bugs in the narrow sense, but they were still part of the delivery surface.

## Lesson

Publishing is not just `npm publish`.

For a CLI product, release correctness includes:

- package name viability
- runtime compatibility after install
- included file set
- executable entrypoint correctness
- operator prerequisites such as OTP

Skipping this discipline creates churn:

- unnecessary version bumps
- failed releases
- confusing operator expectations about what is already live on npm

## Practical Rule

Use this sequence every time:

1. bump the version only when the repo state is truly release-ready
2. run the repo checks
3. run `npm publish --dry-run --access public`
4. verify installed-package behavior when packaging-sensitive code changed
5. run the real publish with OTP ready

If 2FA is enabled, keep the normal `npm login` / browser or interactive approval flow attached. Do not switch to `--otp`.

## Applied Here

This lesson was applied by:

- validating the scoped package on npm before publish
- dry-running package publish before real publish
- fixing bundled template path resolution before the next publish attempt
- standardizing the final operator instruction to `npm login`, then `npm publish --access public` in the same attached flow

Superseded note: earlier drafts mentioned `--otp`; current repo policy forbids OTP fallback because it repeatedly caused failed remote release handoffs.
