# Releasing Paseo Hub

Hub releases publish the npm executable locally, then push a Git tag that publishes the container image and GitHub release.

## Prepare

Update `package.json` and `CHANGELOG.md` to the same version, commit the release on `main`, and push it. Confirm npm authentication and run the release checks:

```sh
npm whoami
npm run release:check
```

`release:check` verifies release metadata, types, lint, formatting, the production build, and the npm package contents.

## Publish npm locally

Publish from a clean `main` checkout:

```sh
npm publish --access public
npm view @getpaseo/hub version
```

Verify the public package from a directory outside the repository before creating the release tag:

```sh
cd "$(mktemp -d)"
npx @getpaseo/hub
```

Open the URL printed by Hub and stop it with Ctrl+C after the first-run page loads.

## Publish the container and GitHub release

Create and push the matching tag:

```sh
HUB_VERSION=$(node -p "require('./package.json').version")
git tag "v$HUB_VERSION"
git push origin "v$HUB_VERSION"
```

The tag workflow publishes `ghcr.io/getpaseo/hub:<version>` and `latest` for stable releases, then creates the GitHub release from the matching changelog section.
