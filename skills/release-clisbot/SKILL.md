---
name: release-clisbot
description: Release clisbot safely to npm and GitHub. Use when Codex is asked to prepare, validate, bump, publish, tag, or document a clisbot beta release such as 0.1.53-beta.1 or 0.1.53-beta.2, or an official stable/latest release such as 0.1.53, including release notes, migration notes, GitHub release notes, npm dist-tags, and post-publish verification.
---

# Release Clisbot

Use this skill from the current `clisbot` checkout. Do not assume or record a
machine-specific absolute path; verify the repo root by finding `package.json`
with package name `clisbot` and the repo `AGENTS.md`.

## Hard Rules

- Never use `npm publish --otp`, `npm login --otp`, or any OTP fallback.
- Run `npm login` and `npm publish --access public` in an attached session.
- If npm returns a browser approval URL, send that exact URL to the operator and continue the same attached session after approval.
- If npm returns `EOTP` or demands OTP instead of browser approval, stop and ask; do not invent a manual OTP path.
- Do not publish until version, docs, release notes, migration decision, gates, and package dry-run are aligned.
- If any release path, version, tag, or migration requirement is unclear, ask before publishing.
- Do not include local machine paths in release notes, GitHub Releases, or skill reports unless the operator explicitly asks for a local filesystem path.

## Preflight

1. Start from the current checkout root, not a hard-coded path:

   ```bash
   test "$(node -p "require('./package.json').name")" = "clisbot"
   ```

2. Read `AGENTS.md`, `docs/development/README.md`, and `docs/development/release-process.md`.
3. Inspect `git status --short`, `package.json`, `CHANGELOG.md`, `docs/releases/README.md`, `docs/releases/upcoming.md`, `docs/migrations/index.md`, and the latest `docs/updates/releases/*-release-guide.md`.
4. Decide the release lane: first beta, next beta, or official stable/latest.
5. Confirm there are no unrelated uncommitted changes that should be excluded from the release.
6. If publishing is requested, confirm npm auth with `npm whoami` after `npm login` when auth may be stale.

## Version Lanes

Use SemVer prerelease syntax with a hyphen.

```text
0.1.52 < 0.1.53-beta.1 < 0.1.53-beta.2 < 0.1.53
```

Do not use `0.1.53.beta.1`.

First beta:

```bash
npm version 0.1.53-beta.1 --no-git-tag-version
npm login
npm publish --access public --tag beta
npm view clisbot@beta version
npm view clisbot dist-tags
```

Next beta after fixes:

```bash
npm version 0.1.53-beta.2 --no-git-tag-version
npm login
npm publish --access public --tag beta
npm view clisbot@beta version
npm view clisbot dist-tags
```

Stable/latest:

```bash
npm version 0.1.53 --no-git-tag-version
npm login
npm publish --access public
npm view clisbot version
npm view clisbot dist-tags
```

`--no-git-tag-version` intentionally updates `package.json` and lockfile without creating an automatic git commit or tag. Commit and tag only after validation and publish state are known.

## Release Documents

Before publish, update or explicitly decide no-op for:

- `docs/releases/upcoming.md` for beta history before stable.
- `docs/releases/vX.Y.Z.md` when cutting stable.
- `CHANGELOG.md` for stable/public release index entries.
- `docs/updates/releases/vX.Y.Z-release-guide.md` only for large operator-facing releases.
- `docs/migrations/index.md` every release to state direct/manual path truthfully.
- `docs/migrations/vA.B.C-to-vX.Y.Z.md` only when manual operator action is required.
- GitHub Release notes: short summary, install/update command, migration statement, validation summary, and links back to docs release note and migration index.

For beta releases, do not add every beta to `CHANGELOG.md` unless the beta itself is intentionally public-facing release history. Track beta details in `docs/releases/upcoming.md`, and summarize meaningful beta history in stable `Pre-Release History`.

## Validation

Run at minimum:

```bash
bun run check
bun run build
git diff --check
npm publish --dry-run --access public
```

If runtime, channel, migration, startup, queue, loop, or prompt behavior changed, run targeted tests and relevant live E2E before publish. Report exact commands and pass/fail.

## Git And Push

After publish verification:

1. Commit the release docs/version change with a clear message.
2. Create a git tag that matches the npm version, for example `v0.1.53-beta.1` or `v0.1.53`.
3. Push branch and tags only after the publish and verification facts are correct.
4. Create the GitHub Release from the matching tag. Use prerelease=true for beta tags and latest=true only for stable.
