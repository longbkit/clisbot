import { expect, test } from "vitest";
import { quickStartOwnerForActor } from "./identity.js";
const actor = {
  kind: "user" as const,
  id: "alice",
  hubIdentity: "stable-hub",
  hubOrigin: "https://old.test",
  organizationId: "org",
  memberId: "old-member",
};
test("ownership survives URL and membership record changes, but separates Hub and organization", () => {
  expect(
    quickStartOwnerForActor(
      { ...actor, hubOrigin: "https://new.test", memberId: "new-member" },
      true,
    ),
  ).toEqual(quickStartOwnerForActor(actor, true));
  expect(quickStartOwnerForActor({ ...actor, hubIdentity: "other" }, true)).not.toEqual(
    quickStartOwnerForActor(actor, true),
  );
  expect(quickStartOwnerForActor({ ...actor, organizationId: "other" }, true)).not.toEqual(
    quickStartOwnerForActor(actor, true),
  );
});
test("managed connections never fall through to local owner, including old Hubs", () => {
  expect(() => quickStartOwnerForActor(undefined, true)).toThrow("identify");
  expect(() => quickStartOwnerForActor({ ...actor, hubIdentity: undefined }, true)).toThrow(
    "Update",
  );
  expect(quickStartOwnerForActor(undefined, false)).toEqual({ kind: "hostOwner" });
});
