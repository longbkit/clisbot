# npm web authentication and publication verification

During the Clisbot 2.0.0 and 2.0.1 releases, repeated authentication requests and an unavailable package delayed publication after CI passed.

## Follow the normal authentication flow

- Read the earlier lesson on the archived branch: `origin/clisbot-v1-tmux-acp-deprecated:docs/lessons/2026-04-08-npm-release-flow-needs-explicit-publish-discipline.md`.
- Use standard `npm login` and publish in an attached TTY. Keep that process alive while completing its exact browser authentication URL.
- Do not patch npm authentication, reuse an OTP across writes, or request a new token merely to avoid browser confirmation.
- Login does not eliminate verification for every registry write. In 2.0.1 every publish and every dist-tag write opened its own browser prompt, even after the five-minute "do not challenge npm publish" box was ticked: 21 packages took 42 prompts and about 25 minutes.
- Without a TTY, npm fails each write with `EOTP` instead of printing the URL. Run the release under a pseudo-terminal with stdin held open, for example `(sleep 3600) | script -q -F <log> npm run release:publish`, and read the URLs from the log.
- The `muxbot` npm session and its passkey live in the Default Chrome profile (Google Password Manager). Open each URL there with `open -na "Google Chrome" --args --profile-directory=Default <url>`. Other profiles are signed out or offer the wrong account's saved password.
- When the existing browser session allows confirmation through its saved passkey, complete the authorized operation there. Ask the user only when the browser actually requires their intervention.
- `npm publish --tag latest` already sets `latest`. `scripts/npm-release.mjs` reads the current tags and writes only the missing ones.

## Verify the registry before reporting success

A successful `npm publish` message is not sufficient evidence that users can install the package.

For `@clisbot/server`, the public registry temporarily exposed only `0.0.0-stage`; both `npm stage list` and the account's staged-packages page were empty. A retry using npm 11 returned `409: Cannot publish over previously staged version "2.0.0"`. The original version subsequently became publicly available with exactly the smoke-tested checksum. The cause and any relationship to the retry were **not established**. Do not describe this as a confirmed authentication failure, npm review, or a guaranteed fix.

It recurred in 2.0.1 for `@clisbot/server` only (the largest package): `npm publish` printed `+ @clisbot/server@2.0.1` and both tag writes succeeded, yet `npm view @clisbot/server@2.0.1` returned E404 for several minutes. It then became visible with no retry. Wait and poll; do not republish.

Before declaring publication complete:

1. Check every version's `dist.integrity` against the tested archive and check the expected dist-tags.
2. Install the public entry package into an isolated prefix and run its CLI aliases and help.
3. Check the installed runtime dependency graph. SDK-only packages need not be installed by the public CLI entry.
4. On a staging placeholder, inspect the staging queue first; do not bump the version, change archive contents, or repeatedly request authentication without new evidence.

For this release, all 21 public archives and both tags were verified. A fresh registry installation installed 20 Clisbot runtime packages at 2.0.0; the remaining package, `@clisbot/plugin`, is the SDK. Both `clisbot` and `clis` reported 2.0.0.
