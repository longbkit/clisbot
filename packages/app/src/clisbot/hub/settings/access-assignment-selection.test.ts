import { describe, expect, it, vi } from "vitest";
import type { AccessCatalog } from "./access-catalog";
import { resolveAssignmentSelection } from "./access-assignment-selection";
import type { ViewerAuthority } from "./access-grantor";

// Only the pure selection logic is under test; these modules render React Native views.
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: vi.fn() }));
vi.mock("./multi-select-field", () => ({
  MultiSelectField: () => null,
  selectionLabel: () => null,
}));
vi.mock("@/components/ui/select-field", () => ({ SelectField: () => null }));

const DEVELOPER = ["daemon.connect", "project.use", "terminal.profile.use", "hub.access.manage"];
const FULL_ACCESS = [...DEVELOPER, "terminal.use", "workspace.manage"];
const PROJECT_OFFICE_WORKER = ["project.use", "agent.interact", "agent.create", "approval.file"];
const catalog = {
  privileges: [],
  accessLevels: {
    daemon: { developer: DEVELOPER, full_access: FULL_ACCESS },
    project: { office_worker: PROJECT_OFFICE_WORKER },
  },
  resources: [
    { kind: "daemon", id: "host", name: "Host", parent: null, available: true },
    {
      kind: "project",
      id: "bot-home",
      name: "Ada",
      parent: { kind: "daemon", id: "host" },
      available: true,
      bot: { id: "bot_1", kind: "personal" },
    },
  ],
} as unknown as AccessCatalog;

function selection(
  authority: ViewerAuthority,
  accessLevel: string,
  resourceKeyValue = "daemon\u0000host",
) {
  return resolveAssignmentSelection({
    editing: null,
    catalog,
    authority,
    subjectKeyValue: "member\u0000m",
    resourceKeyValue,
    alsoResourceKeys: [],
    accessLevel,
    canShare: true,
    terminal: false,
    terminalProfiles: null,
    projectFolders: null,
    agentConfigurations: [],
  });
}

function grantedHost(privileges: string[], constraints: Record<string, unknown>): ViewerAuthority {
  return {
    unrestricted: false,
    grants: [
      {
        assignmentId: "own",
        resource: { kind: "daemon", id: "host", name: "Host", parent: null, available: true },
        privileges,
        constraints,
        source: { kind: "direct" },
      },
    ],
  } as unknown as ViewerAuthority;
}

describe("resolveAssignmentSelection defaults", () => {
  it("offers every profile by default only to a grantor who can pass them all on", () => {
    expect(selection({ unrestricted: true }, "developer").terminalProfiles).toBe("*");
    const limited = grantedHost(DEVELOPER, { terminalProfiles: ["claude"] });
    const chosen = selection(limited, "developer");
    expect(chosen.terminalProfiles).toEqual([]);
    expect(chosen.valid).toBe(false);
  });

  it("passes a narrowed grantor's folders on without being asked", () => {
    const narrowed = grantedHost(FULL_ACCESS, {
      terminalProfiles: "*",
      projectFolders: { allow: ["/workspace/qc/**"], deny: ["/workspace/qc/prod/**"] },
    });
    expect(selection(narrowed, "full_access").projectFolders).toEqual({
      allow: ["/workspace/qc/**"],
      deny: ["/workspace/qc/prod/**"],
    });
    expect(selection({ unrestricted: true }, "full_access").projectFolders).toBeNull();
  });

  it("resolves a Bot's Project as a Project grant with Project levels", () => {
    const chosen = selection({ unrestricted: true }, "office_worker", "project\u0000bot-home");
    expect(chosen.resource?.bot).toEqual({ id: "bot_1", kind: "personal" });
    expect(chosen.levelOptions.map(({ value }) => value)).toEqual(["office_worker"]);
    // The helper switches Can share on, so the level's privileges gain `hub.access.manage`.
    expect(chosen.privileges).toEqual([...PROJECT_OFFICE_WORKER, "hub.access.manage"]);
    expect(chosen.needsAgentConfiguration).toBe(true);
    expect(chosen.createsProjects).toBe(false);
  });
});
