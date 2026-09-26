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
const catalog = {
  privileges: [],
  accessLevels: { daemon: { developer: DEVELOPER, full_access: FULL_ACCESS } },
  resources: [{ kind: "daemon", id: "host", name: "Host", parent: null, available: true }],
} as unknown as AccessCatalog;

function selection(authority: ViewerAuthority, accessLevel: string) {
  return resolveAssignmentSelection({
    editing: null,
    catalog,
    authority,
    subjectKeyValue: "member\u0000m",
    resourceKeyValue: "daemon\u0000host",
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
});
