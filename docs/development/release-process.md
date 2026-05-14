# clisbot Release Process

Use this runbook for `clisbot` npm and GitHub releases.

## Release Lanes

Use SemVer prerelease syntax with a hyphen:

```text
0.1.52 < 0.1.53-beta.1 < 0.1.53-beta.2 < 0.1.53
```

Do not use `0.1.53.beta.1`.

## Before Any Publish

1. Inspect `git status --short`.
2. Confirm the intended version in `package.json`.
3. Update release documentation:
   - `docs/releases/upcoming.md` for beta notes before stable.
   - `docs/releases/vX.Y.Z.md` when cutting the stable release note.
   - `CHANGELOG.md` for stable public release index entries.
   - `docs/updates/releases/vX.Y.Z-release-guide.md` only when operators need a short rollout guide.
   - `docs/migrations/index.md` for the update path and manual-action decision.
   - `docs/migrations/vA.B.C-to-vX.Y.Z.md` only when manual operator action is required.
4. Run gates:

```bash
bun run check
bun run build
git diff --check
npm publish --dry-run --access public
```

If runtime, channel, config migration, startup, queue, loop, prompt, or package layout changed, add targeted tests and live E2E evidence before publishing.

## First Beta

From the previous stable line, for example `0.1.52` to `0.1.53-beta.1`:

```bash
npm version 0.1.53-beta.1 --no-git-tag-version
npm login
npm publish --access public --tag beta
npm view clisbot@beta version
npm view clisbot dist-tags
```

Expected result:

- `clisbot@beta` points to `0.1.53-beta.1`.
- `clisbot@latest` is unchanged.

## Next Beta

If beta testers find issues, fix them and bump the prerelease number:

```bash
npm version 0.1.53-beta.2 --no-git-tag-version
npm login
npm publish --access public --tag beta
npm view clisbot@beta version
npm view clisbot dist-tags
```

Never republish the same version. npm versions are immutable.

## Stable / Latest

When the beta line is ready for the official release:

```bash
npm version 0.1.53 --no-git-tag-version
npm login
npm publish --access public
npm view clisbot version
npm view clisbot dist-tags
```

Expected result:

- `clisbot@latest` points to `0.1.53`.
- `0.1.53` is higher than all `0.1.53-beta.N` builds.

## npm Auth Rules

Run `npm login` and `npm publish --access public` in an attached session.

If npm prints a browser approval URL, send that exact URL to the operator and continue the same attached session after approval.

Never use:

```bash
npm publish --otp <code>
npm login --otp <code>
npm publish --otp=<code>
```

If npm returns `EOTP` or demands OTP instead of browser approval, stop and ask. Do not invent a fallback path.

## Git Tags And GitHub Releases

After npm verification:

```bash
git status --short
git add package.json package-lock.json CHANGELOG.md docs/releases docs/updates docs/migrations
git commit -m "Release clisbot v0.1.53-beta.1"
git tag v0.1.53-beta.1
git push
git push --tags
```

For stable, use `v0.1.53` in the commit and tag.

Create a GitHub Release from the matching tag:

- mark beta tags as prerelease
- mark stable tags as latest
- include a short summary, install/update command, migration statement, validation summary, and links to the canonical release note and migration index

GitHub Release body template:

````markdown
## Summary

- ...

## Install / Update

```bash
npm install -g clisbot@beta
# or for stable:
npm install -g clisbot@0.1.53
```

## Migration

- Manual migration: none. See docs/migrations/index.md.

## Validation

- `bun run check`
- `bun run build`
- `git diff --check`
- `npm publish --dry-run --access public`

## Links

- Release note: docs/releases/v0.1.53.md
- Migration index: docs/migrations/index.md
````
