import { describe, expect, it } from "vitest";
import { accessRowFacts } from "./access-summary";
import type { HubAssignment } from "./team/types";

const developer = {
  id: "grant",
  subjectKind: "member",
  subjectId: "m-ana",
  resourceKind: "project",
  resourceId: "project",
  privileges: ["project.use", "hub.access.manage"],
  constraints: {},
  createdByUserId: "u-bo",
} as unknown as HubAssignment;

describe("accessRowFacts", () => {
  it("shows Can share and who granted it, as the Access page rows do", () => {
    const names = new Map([["u-bo", "Bo"]]);
    expect(accessRowFacts({ assignment: developer, source: "Direct" }, "Developer", names)).toBe(
      "Developer · Can share · Direct · by Bo",
    );
    const hubWritten = { ...developer, privileges: ["project.use"], createdByUserId: null };
    expect(accessRowFacts({ assignment: hubWritten, source: "Via QC" }, "Developer", names)).toBe(
      "Developer · Via QC · by Hub",
    );
    expect(
      accessRowFacts({ assignment: developer, source: "Direct" }, "Developer", undefined),
    ).toBe("Developer · Can share · Direct");
  });
});
