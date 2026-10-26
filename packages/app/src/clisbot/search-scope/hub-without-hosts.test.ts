import { describe, expect, it } from "vitest";
import { buildSearchScopeCatalog } from "./catalog";
import { buildScopeRows, type ScopeT } from "./rows";
import { inSearchScope, resolveSearchScope } from "./model";

const t: ScopeT = (key) => key;

// Round 2, D3: a Hub the reader is signed in to, with no Host shared yet, is still findable and
// its row says why there is nothing under it.
describe("a signed-in Hub with no visible Host", () => {
  const catalog = buildSearchScopeCatalog({
    hosts: [],
    projects: [],
    agents: [],
    signedInHubs: [{ origin: "https://hub.example", name: "Vexere" }],
  });

  it("is a Hub row that explains it has no Host and cannot open in the Workspace list", () => {
    const [row] = buildScopeRows([{ kind: "hub", hub: catalog.hubs[0]!, outOfScope: false }], {
      catalog,
      t,
      formatTime: (iso) => iso,
      projectChipKeys: [],
    } as Parameters<typeof buildScopeRows>[1]);
    expect(row).toMatchObject({
      title: "Vexere",
      note: "hubRow.noHosts",
      workTarget: null,
      chips: [{ kind: "hub", origin: "https://hub.example", label: "Vexere" }],
    });
  });

  it("scopes to nothing, so search lands on its empty state", () => {
    const scope = resolveSearchScope(
      [{ kind: "hub", origin: "https://hub.example", label: "Vexere" }],
      catalog.serverIdsByHub,
    );
    expect(inSearchScope(scope, "any-host", null)).toBe(false);
  });
});
