import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  canChangeMemberRole,
  canRemoveMember,
  capabilitiesFor,
  parseOrganizationRole,
} from "../auth/organization-policy.js";

describe("organization role policy", () => {
  it("maps the three roles to one capability policy", () => {
    assert.deepEqual(capabilitiesFor("owner"), {
      view: true,
      manageMembers: true,
      manageOwners: true,
      manageResources: true,
    });
    assert.deepEqual(capabilitiesFor("admin"), {
      view: true,
      manageMembers: true,
      manageOwners: false,
      manageResources: true,
    });
    assert.deepEqual(capabilitiesFor("member"), {
      view: true,
      manageMembers: false,
      manageOwners: false,
      manageResources: false,
    });
  });

  it("fails closed for unknown or combined roles", () => {
    assert.equal(parseOrganizationRole("manager"), undefined);
    assert.equal(parseOrganizationRole("owner,admin"), undefined);
  });

  it("keeps owner lifecycle authority out of the admin role", () => {
    assert.equal(canChangeMemberRole("admin", "member", "admin"), true);
    assert.equal(canChangeMemberRole("admin", "owner", "admin"), false);
    assert.equal(canChangeMemberRole("admin", "admin", "owner"), false);
    assert.equal(canRemoveMember("admin", "member"), true);
    assert.equal(canRemoveMember("admin", "owner"), false);
  });
});
