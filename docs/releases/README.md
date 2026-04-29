# Release Notes

## Purpose

Use `docs/releases/` as the canonical version-bound release history for `clisbot`.

Release notes answer: what changed in this version, what user or operator impact it has, and which update or validation facts matter later.

Keep narrative catch-up material in [`docs/updates/`](../updates/README.md). Keep the general package update runbook in [`docs/update/`](../update/README.md). Keep manual migration procedures in [`docs/migrations/`](../migrations/README.md).
GitHub Releases and npm notes should stay shorter and link back to the matching release note here.

## File Layout

- [`upcoming.md`](upcoming.md): staging area for work that is expected to become the next public release note
- `vX.Y.Z.md`: one file per shipped version
- [`templates/release-note.md`](templates/release-note.md): the required structure for future version notes

## Writing Rule

Release notes here should optimize for:

- very easy to scan
- clear user impact
- grouped changes by feature area instead of commit-by-commit noise
- plain language first, technical detail second

Use the current feature taxonomy from [`docs/features/feature-tables.md`](../features/feature-tables.md):

- Functional changes: `Channels`, `Auth`, `Agents`, `Runners`, `Control`, `Configuration`, and `DX`
- Non-functional changes: `Stability`, `Security`, `Architecture Conformance`, and `Runtime Benchmarks`

Inside each feature area, use Keep a Changelog verbs when they apply:

- `Added`
- `Changed`
- `Deprecated`
- `Removed`
- `Fixed`
- `Security`

Omit empty feature areas and empty verbs. If one change spans multiple areas, place it under the area with the main user-facing ownership and mention the secondary area in the bullet.

## Release Bundle Rule

For a normal release, update:

1. [`CHANGELOG.md`](../../CHANGELOG.md): short version index only.
2. `docs/releases/vX.Y.Z.md`: canonical version note.
3. `docs/updates/releases/vX.Y.Z-operator-brief.md`: only for large releases where operators need a 3-5 minute digest.
4. `docs/update/README.md`: update the current stable update note when the public update path changes.
5. `docs/migrations/vA.B.C-to-vX.Y.Z.md`: only when config, schema, or runtime update steps require manual operator action beyond install/restart/status.

Do not duplicate the full release detail across these files. Link between them.

## Beta And Pre-Release Rule

Use beta notes to support testers and operators, not as a second release-history system.

- If a beta is part of an upcoming public release, track it in `upcoming.md` until the release ships.
- When the public release note is cut, summarize meaningful beta history inside that release note under `Pre-Release History`.
- Do not add every beta to `CHANGELOG.md`; keep `CHANGELOG.md` focused on public release targets.
- Create `docs/updates/releases/vX.Y.Z-beta.N-operator-brief.md` only when a beta is sent to users/operators and needs a rollout note.
- Create a migration note for a beta only when beta testers need a concrete update or rollback runbook.

## Current Notes

- [Upcoming](upcoming.md)
- [v0.1.45](v0.1.45.md)
- [v0.1.43](v0.1.43.md)
- [v0.1.41](v0.1.41.md)
- [v0.1.39](v0.1.39.md)
