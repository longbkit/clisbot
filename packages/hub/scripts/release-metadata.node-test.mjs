import assert from "node:assert/strict";
import test from "node:test";
import { imageTags, releaseMetadata } from "./release-metadata.mjs";

const changelog = `# Changelog

## 0.1.0 - 2026-08-07

### Added

- First release.

## 0.0.1-beta.1 - 2026-08-01

- Preview.
`;

test("extracts the exact stable release section", () => {
  assert.deepEqual(releaseMetadata({ tag: "v0.1.0", packageVersion: "0.1.0", changelog }), {
    version: "0.1.0",
    prerelease: false,
    notes: "## 0.1.0 - 2026-08-07\n\n### Added\n\n- First release.\n",
  });
});

test("marks prereleases without selecting a different changelog section", () => {
  const metadata = releaseMetadata({
    tag: "v0.0.1-beta.1",
    packageVersion: "0.0.1-beta.1",
    changelog,
  });
  assert.equal(metadata.prerelease, true);
  assert.match(metadata.notes, /Preview/u);
  assert.doesNotMatch(metadata.notes, /First release/u);
});

test("publishes latest only for stable releases", () => {
  assert.deepEqual(imageTags("GetPaseo", { version: "0.1.0", prerelease: false }), [
    "ghcr.io/getpaseo/hub:0.1.0",
    "ghcr.io/getpaseo/hub:latest",
  ]);
  assert.deepEqual(imageTags("GetPaseo", { version: "0.2.0-beta.1", prerelease: true }), [
    "ghcr.io/getpaseo/hub:0.2.0-beta.1",
  ]);
});

test("rejects a tag that does not match package.json", () => {
  assert.throws(
    () => releaseMetadata({ tag: "v0.2.0", packageVersion: "0.1.0", changelog }),
    /does not match package\.json version/u,
  );
});

test("rejects a release without matching changelog notes", () => {
  assert.throws(
    () => releaseMetadata({ tag: "v0.1.0", packageVersion: "0.1.0", changelog: "# Changelog\n" }),
    /no release section/u,
  );
});
