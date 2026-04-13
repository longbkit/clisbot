---
title: Packaged Runtime Must Not Assume Repo Layout
date: 2026-04-08
area: packaging, runtime, agents
summary: Code that works from the repo tree can still fail after npm packaging if it assumes src-relative file layout. Bundled runtime paths must be resolved against both dev and packaged layouts, then tested explicitly.
related:
  - src/agents/bootstrap.ts
  - test/bootstrap.test.ts
  - package.json
---

## Context

This lesson came from a real packaged install failure:

- `clisbot start --cli codex --bootstrap personal-assistant`
- error: `ENOENT: no such file or directory, scandir '.../node_modules/@clisbot/templates/openclaw'`

The root cause was simple:

- bootstrap templates were resolved relative to the source layout
- that layout worked in the repo during development
- after bundling to `dist/main.js` and installing from npm, the relative path changed
- runtime still looked for the old tree shape

This is exactly the kind of bug that static repo testing misses unless the packaged layout is exercised directly.

## Lesson

Do not assume that `import.meta.url` plus a few `..` segments will still point at the correct assets after bundling and packaging.

For any runtime asset lookup:

- identify all supported layouts explicitly
- resolve against those layouts deliberately
- add a test that simulates the packaged install tree, not just the repo tree

## Practical Rule

Before shipping code that reads bundled assets:

1. Verify the path in the repo layout.
2. Verify the path in the packaged layout.
3. Prefer a resolver with explicit candidate roots over one blind relative-path assumption.
4. Add a regression test for the packaged layout.

## Applied Here

This lesson was applied by:

- replacing the single hard-coded template root assumption in `src/agents/bootstrap.ts`
- resolving both repo layout and packaged `dist` layout
- adding `test/bootstrap.test.ts`
- validating the built package from a fake `node_modules/clisbot` tree with isolated `HOME`
