import { describe, expect, it } from "vitest";
import { settledHostIds } from "./settled-host-ids";

describe("settledHostIds", () => {
  const settled = { registryLoaded: true, hubsSettled: true, registered: ["local"], listed: [] };

  it("judges nothing while the registry or a Hub list is still loading", () => {
    expect(settledHostIds({ ...settled, registryLoaded: false })).toBeNull();
    expect(settledHostIds({ ...settled, hubsSettled: false })).toBeNull();
  });

  it("counts a Host a Hub lists before the registry has added it", () => {
    const ids = settledHostIds({
      ...settled,
      listed: [{ connectionOffer: { serverId: "company-7" } }, { connectionOffer: null }, {}],
    });
    expect([...(ids ?? [])].sort()).toEqual(["company-7", "local"]);
  });

  it("leaves out a Host neither the registry nor any Hub knows", () => {
    expect(settledHostIds(settled)?.has("removed")).toBe(false);
  });
});
