# Releasing Clisbot Hub

Hub package releases and the shared Clisbot container use separate versions.
Only the root Docker workflow publishes the container; see
[Docker publishing](../../../docs/docker.md#building-locally).
The standalone procedure below covers the npm package and release notes.
The nested Hub workflow does not run automatically in this monorepo.

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
npm view @clisbot/hub version
```

Verify the public package from a directory outside the repository before creating the release tag:

```sh
cd "$(mktemp -d)"
npx @clisbot/hub
```

Open the URL printed by Hub and stop it with Ctrl+C after the first-run page loads.

## Publish standalone Hub release notes

Create and push the matching tag:

```sh
HUB_VERSION=$(node -p "require('./package.json').version")
git tag "v$HUB_VERSION"
git push origin "v$HUB_VERSION"
```

The standalone tag workflow creates the GitHub release from the changelog.
It does not publish a separate Hub container or overwrite the shared image.
