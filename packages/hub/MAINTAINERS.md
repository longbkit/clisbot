# Maintaining Paseo Hub

This guide covers repository operations for maintainers. Product usage belongs in the
[public Hub documentation](https://paseo.sh/docs/hub); architecture decisions live under
[`docs/`](docs/).

## Verify a change

The required checks match the jobs in [CI](.github/workflows/ci.yml):

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run db:check
npm run build
npm run docker:smoke
npm run test:e2e:browser
npm run test:e2e:hub:source
```

The source-built browser and Hub suites use the exact Paseo commit in `PASEO_E2E_COMMIT`.
When a Hub change depends on a Paseo protocol or CLI change, update that immutable SHA and
prove the combined contract before merging. Do not replace it with a branch or another mutable
reference.

Use the repository formatter through `npm run format` or `npm run format:files`. This repository
uses Oxfmt, not Prettier.

## Publish a release

Hub releases contain a multi-architecture container image and a GitHub Release. There are no
separate binary assets.

1. Update the version in `package.json` and `package-lock.json`.
2. Add a matching `## <version> - YYYY-MM-DD` section to `CHANGELOG.md`.
3. Run the release metadata test:

   ```sh
   npm run test:release
   ```

4. Commit the release preparation to `main`.
5. Create an annotated tag on the intended release commit and push it:

   ```sh
   git tag -a v<version> <commit> -m "Paseo Hub v<version>"
   git push origin v<version>
   ```

The tag must match both `package.json` and the changelog section. A tag push runs only the
[Release](.github/workflows/release.yml) workflow; it does not rerun the main CI suite. The
workflow publishes `ghcr.io/getpaseo/hub:<version>`, updates `latest` for stable releases, and
creates or updates the GitHub Release from the matching changelog section. Prereleases do not
move `latest`.

Verify the GitHub Release and anonymous access to both image tags before announcing the release.
Later changes to the current changelog section update the existing release notes through
[Release Notes Sync](.github/workflows/release-notes-sync.yml).

## Update public documentation

Public Hub documentation lives in `getpaseo/paseo` under `public-docs/`. Externally visible Hub
changes require a companion Paseo pull request. Keep task guides progressive and examples
complete; keep exhaustive field documentation in reference pages.
