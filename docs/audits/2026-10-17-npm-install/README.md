# npm 10 global installation

On 2026-10-17, Node 22.22.3 / npm 10.9.8 failed while resolving the published
`clisbot@2.0.0` graph. The last pre-v2 release, `0.1.54-beta.3`, resolved with the
same installer and registry. All published branded Hub releases from 2.0.0 through
2.1.2 declare Better Auth 1.6.23 and TanStack Start 1.168.28.

This identifies the earliest currently reproducible branded release, not the date
the failure began. Transitive peer ranges resolve against today's registry; no
successful installation graph from the original publication dates was retained.
The CLI's Hub dependency entered this fork in `c73fb444417316406c2299a0ecf0accded8e1e3c`
(2026-08-26); `3eae83f33a2ffa6d7d3d2ca4d11497dc3f3c3a45` renamed that edge to
`@clisbot/hub` (2026-09-29). These source changes precede the first branded npm
release and do not establish when the changing registry graph first triggered npm.

A diagnostic copy of npm 10 logged detached `vitest@4.1.12` while visiting its
`@vitest/coverage-istanbul` peer. npm continued traversing that node after a circular
peer resolution replaced it, then read `node.parent.edgesOut` with a null parent.
[npm/cli#8448](https://github.com/npm/cli/pull/8448) fixes that traversal. The guard
is present in npm 11.21.1 and absent from npm 10.9.8. npm 11 installs the unchanged
Clisbot graph, but requiring a separate npm upgrade leaves the supported npm 10
entry point broken.
A private npm 10 diagnostic with only that guard added also resolved the unchanged
2.0.0 graph after logging the same detached node. The fix does not patch user npm.

The correction bundles Better Auth and its OAuth provider's existing production closure in Hub. It keeps
the same dependency versions, original package files, licenses and runtime API.
The build copies hoisted modules selected by the root lockfile into Hub's package-local node_modules before
standard npm packing. A real packed-fixture test covers nested conflicting versions
and missing dependencies, and refreshes staged modules on subsequent builds.
The OAuth provider stays in the same local package group so its Better Auth
TypeScript module augmentation resolves to the same core instance on later builds.
Installed smoke covers the real auth server, including
the cookie hook's dynamic Start import, rejected credentials and successful retry.

Moving Start to devDependencies alone was rejected: the cookie integration still
imports `@tanstack/react-start/server` at runtime. Arbitrary peer pins and installer
flags that suppress dependency or lifecycle checks were also rejected. The bundle
adds distribution size and makes rebuild/publication necessary to update included
dependencies; the repository lockfile remains their version source.

Backout is a revert of the bundle manifest, staging helper and build invocation,
followed by a new package version. That restores the npm 10 failure until another
correction is supplied. Never replace an already published tarball.
