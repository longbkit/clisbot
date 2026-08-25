import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { splitRepoFullName } from "./repo.js";

describe("splitRepoFullName", () => {
  it("splits valid repo name into owner and repo", () => {
    assert.deepEqual(splitRepoFullName("acme/widgets"), ["acme", "widgets"]);
  });

  it("throws on invalid repo name with no slash", () => {
    assert.throws(() => splitRepoFullName("acmewidgets"), /invalid repo name/);
  });

  it("throws on too many slashes", () => {
    assert.throws(() => splitRepoFullName("acme/widgets/extra"), /invalid repo name/);
  });

  it("throws on empty parts", () => {
    assert.throws(() => splitRepoFullName("/widgets"), /invalid repo name/);
    assert.throws(() => splitRepoFullName("acme/"), /invalid repo name/);
  });
});
