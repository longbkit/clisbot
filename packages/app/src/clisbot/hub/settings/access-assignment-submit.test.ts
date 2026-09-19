import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessAssignment, AccessResource } from "./access-catalog";
import type { AssignmentSelection } from "./access-assignment-selection";
import { submitAccessAssignment } from "./access-assignment-submit";
import type { ViewerAuthority } from "./access-grantor";

const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: confirm }));
// The row list renders React Native views; only its subject naming is used here.
vi.mock("./access-assignment-list", () => ({ assignmentSubjectName: () => "Member" }));
vi.mock("./multi-select-field", () => ({
  MultiSelectField: () => null,
  selectionLabel: () => null,
}));
vi.mock("@/components/ui/select-field", () => ({ SelectField: () => null }));

const host = {
  kind: "daemon",
  id: "host",
  name: "Host",
  available: true,
  parent: null,
} as AccessResource;
const project = {
  kind: "project",
  id: "project",
  name: "Project",
  available: true,
  parent: { kind: "daemon", id: "host" },
} as AccessResource;
const subject = { kind: "member" as const, id: "membership" };
const selection = {
  subject,
  resource: project,
  alsoResources: [],
  privileges: ["project.use"],
  needsAgentConfiguration: false,
  valid: true,
} as unknown as AssignmentSelection;
const hostRow = {
  id: "host-row",
  subjectKind: "member",
  subjectId: "membership",
  resourceKind: "daemon",
  resourceId: "host",
  privileges: ["daemon.connect", "project.use"],
  constraints: {},
} as unknown as AccessAssignment;

/** A Member who shares only the Project: the catalog hides the Host from them. */
const projectSharer: ViewerAuthority = {
  unrestricted: false,
  grants: [
    {
      assignmentId: "own",
      resource: project,
      privileges: ["project.use", "hub.access.manage"],
      constraints: {},
      source: { kind: "direct" },
    },
  ] as unknown as Extract<ViewerAuthority, { unrestricted: false }>["grants"],
};

async function submit(input: {
  authority: ViewerAuthority;
  catalogResources: AccessResource[];
  assignments: AccessAssignment[];
}) {
  const save = vi.fn(async (_body: unknown, _batch?: boolean) => undefined);
  await submitAccessAssignment({
    isCurrent: () => true,
    editing: null,
    selection,
    members: [],
    teams: [],
    agentConfigurations: [],
    fastMode: false,
    accessLevel: "office_worker",
    save,
    ...input,
  });
  return save;
}

describe("submitAccessAssignment", () => {
  beforeEach(() => {
    confirm.mockReset();
    confirm.mockResolvedValue(true);
  });

  it("sends a Project sharer's grant with the Connect-only Host row instead of refusing", async () => {
    const save = await submit({
      authority: projectSharer,
      catalogResources: [project],
      assignments: [],
    });
    expect(save).toHaveBeenCalledWith(
      {
        assignments: [
          {
            subjectKind: "member",
            subjectId: "membership",
            resourceKind: "daemon",
            resourceId: "host",
            privileges: ["daemon.connect"],
            constraints: {},
          },
          expect.objectContaining({ resourceKind: "project", resourceId: "project" }),
        ],
      },
      true,
    );
    expect(String(confirm.mock.calls[0]?.[0].message)).toContain("unless they already reach it");
  });

  it("does not trust a Host row it cannot see; the Hub drops the Connect row when it is held", async () => {
    const save = await submit({
      authority: projectSharer,
      catalogResources: [project],
      assignments: [hostRow],
    });
    const body = save.mock.calls[0]?.[0] as { assignments: { privileges: string[] }[] };
    expect(body.assignments[0]?.privileges).toEqual(["daemon.connect"]);
  });

  it("saves the Project alone when a viewer who shares the Host sees Connect already held", async () => {
    const save = await submit({
      authority: { unrestricted: true },
      catalogResources: [host, project],
      assignments: [hostRow],
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ resourceKind: "project" }));
  });
});
