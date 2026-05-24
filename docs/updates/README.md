# Updates

## Purpose

Use `docs/updates/` for user-facing update docs that help people install, catch up, and understand what changed.

Version-bound truth lives in [`docs/releases/`](../releases/README.md). Manual-action decisions start in [`docs/migrations/index.md`](../migrations/index.md).

## File Layout

- [`update-guide.md`](update-guide.md): the install/update guide used by `clisbot update`.
- `weekly/YYYY-Www.md`: optional weekly digest when enough meaningful work landed.
- `releases/vX.Y.Z-release-guide.md`: short catch-up guide for notable releases.
- `templates/weekly-update.md`: template for weekly digests.
- `templates/release-guide.md`: template for release guides.

## Writing Rule

Update docs here should answer:

- what matters now
- what the reader should start using
- what changed in operating risk
- what should be watched next

Keep them short and opinionated. Link back to the release note, migration note, feature docs, and task docs instead of repeating their details.

## When To Write One

Write a release guide when a release changes:

- config or schema
- route, auth, or access behavior
- scheduled work or loop behavior
- runtime/session/streaming truthfulness
- setup or migration steps

Write a weekly digest only when there is enough meaningful work for a reader to catch up on. Do not create empty weekly updates just to satisfy cadence.

## Current Updates

- [Update guide](update-guide.md)
- [v0.1.53 release guide](releases/v0.1.53-release-guide.md)
- [v0.1.52 release guide](releases/v0.1.52-release-guide.md)
- [v0.1.51 release guide](releases/v0.1.51-release-guide.md)
- [v0.1.50 release guide](releases/v0.1.50-release-guide.md)
