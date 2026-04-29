# Updates

## Purpose

Use `docs/updates/` for narrative catch-up notes that help operators and users understand what to try, watch, or change.

Updates are not the canonical release ledger. Version-bound truth lives in [`docs/releases/`](../releases/README.md), package update procedure lives in [`docs/update/`](../update/README.md), and manual migration decisions start in [`docs/migrations/index.md`](../migrations/index.md).

## File Layout

- `weekly/YYYY-Www.md`: optional weekly digest when enough meaningful work landed.
- `releases/vX.Y.Z-operator-brief.md`: short operator-facing brief for large releases.
- `templates/weekly-update.md`: template for weekly digests.
- `templates/operator-brief.md`: template for release operator briefs.

## Writing Rule

Updates should answer:

- what matters now
- what the reader should start using
- what changed in operating risk
- what should be watched next

Keep updates short and opinionated. Link back to the release note, migration note, feature docs, and task docs instead of repeating their details.

## When To Write One

Write an operator brief when a release changes:

- config or schema
- route, auth, or access behavior
- scheduled work or loop behavior
- runtime/session/streaming truthfulness
- setup or migration steps

Write a weekly digest only when there is enough meaningful work for a reader to catch up on. Do not create empty weekly updates just to satisfy cadence.

## Current Updates

- [v0.1.45 operator brief](releases/v0.1.45-operator-brief.md)
