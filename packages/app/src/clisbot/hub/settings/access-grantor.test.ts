import { describe, expect, it } from "vitest";
import { HubEffectiveAccessSchema } from "../contracts";
import type { AccessResource } from "./access-catalog";
import {
  canShareResource,
  holdsCanShareAnywhere,
  privilegesWithinHoldings,
  shareableAgentConfigurationCatalog,
  shareableTerminalProfiles,
  sharesEveryTerminalProfile,
  viewerAuthority,
  viewerHoldings,
  type ViewerAuthority,
} from "./access-grantor";
import {
  canShareState,
  levelOptionsWithinHoldings,
  levelSwitchPresets,
  offersTerminalSwitch,
  withCanShare,
  withTerminal,
} from "./access-level-choice";

const host: AccessResource = {
  kind: "daemon",
  id: "host",
  name: "Host",
  parent: null,
  available: true,
};
const project: AccessResource = {
  kind: "project",
  id: "project",
  name: "Project",
  parent: { kind: "daemon", id: "host" },
  available: true,
};
const team: AccessResource = {
  kind: "team",
  id: "team",
  name: "QC",
  parent: null,
  available: true,
};
const resources = [host, project, team];
const OFFICE_WORKER = ["project.use", "agent.interact", "agent.create", "approval.file"];

function effective(
  grants: { resource: AccessResource; privileges: string[]; constraints?: object }[],
) {
  return HubEffectiveAccessSchema.parse({
    owner: false,
    grants: grants.map((grant, index) => ({
      assignmentId: `grant-${String(index)}`,
      resource: grant.resource,
      privileges: grant.privileges,
      constraints: grant.constraints ?? {},
      source: { kind: "direct" },
    })),
  });
}

describe("viewer authority", () => {
  it("is unrestricted for Organization Admins and Owners, not for a Member with grants", () => {
    expect(viewerAuthority(true, undefined).unrestricted).toBe(true);
    expect(viewerAuthority(false, { owner: true, grants: [] }).unrestricted).toBe(true);
    expect(viewerAuthority(false, effective([])).unrestricted).toBe(false);
  });

  it("opens Access for a Member who shares anything, Team Admin included", () => {
    expect(holdsCanShareAnywhere(effective([]))).toBe(false);
    expect(
      holdsCanShareAnywhere(effective([{ resource: team, privileges: ["hub.access.manage"] }])),
    ).toBe(true);
  });

  it("shares a Project through its Host grant, never the Host through a Project grant", () => {
    const hostSharer = viewerAuthority(
      false,
      effective([
        { resource: host, privileges: ["daemon.connect", ...OFFICE_WORKER, "hub.access.manage"] },
      ]),
    );
    expect(canShareResource(hostSharer, project, resources)).toBe(true);
    const projectSharer = viewerAuthority(
      false,
      effective([{ resource: project, privileges: [...OFFICE_WORKER, "hub.access.manage"] }]),
    );
    expect(canShareResource(projectSharer, project, resources)).toBe(true);
    expect(canShareResource(projectSharer, host, resources)).toBe(false);
  });

  it("holds a grant only within its own privileges and Can share", () => {
    const holdings = viewerHoldings(
      viewerAuthority(
        false,
        effective([{ resource: project, privileges: [...OFFICE_WORKER, "hub.access.manage"] }]),
      ),
      project,
      resources,
    );
    expect(privilegesWithinHoldings(holdings, OFFICE_WORKER)).toBe(true);
    expect(privilegesWithinHoldings(holdings, [...OFFICE_WORKER, "terminal.use"])).toBe(false);
    const noShare = viewerHoldings(
      viewerAuthority(false, effective([{ resource: project, privileges: OFFICE_WORKER }])),
      project,
      resources,
    );
    expect(privilegesWithinHoldings(noShare, ["project.use"])).toBe(false);
  });

  it("offers only the levels within the viewer's own, naming the rest", () => {
    const levels = {
      office_worker: OFFICE_WORKER,
      developer: [...OFFICE_WORKER, "terminal.use"],
      full_access: [...OFFICE_WORKER, "terminal.use", "workspace.manage", "hub.access.manage"],
    };
    const holdings = viewerHoldings(
      viewerAuthority(
        false,
        effective([{ resource: project, privileges: [...OFFICE_WORKER, "hub.access.manage"] }]),
      ),
      project,
      resources,
    );
    expect(levelOptionsWithinHoldings(levels, "project", holdings)).toEqual({
      options: [expect.objectContaining({ id: "office_worker", label: "Office worker" })],
      aboveOwn: ["Developer", "Full access"],
    });
    expect(
      levelOptionsWithinHoldings(
        levels,
        "project",
        viewerHoldings(viewerAuthority(true, undefined), project, resources),
      ).aboveOwn,
    ).toEqual([]);
  });

  it("cuts the Agent catalog down to the viewer's own Models and Thinking", () => {
    const catalog = {
      providers: [
        {
          id: "codex",
          label: "Codex",
          models: [
            {
              id: "m1",
              label: "M1",
              thinkingOptions: [
                { id: "low", label: "Low" },
                { id: "high", label: "High" },
              ],
            },
            { id: "m2", label: "M2", thinkingOptions: [] },
          ],
        },
        { id: "claude", label: "Claude", models: [{ id: "c1", label: "C1", thinkingOptions: [] }] },
      ],
    };
    const holdings = viewerHoldings(
      viewerAuthority(
        false,
        effective([
          {
            resource: project,
            privileges: [...OFFICE_WORKER, "hub.access.manage"],
            constraints: {
              agentConfigurations: [
                { providerId: "codex", modelIds: ["m1"], thinkingOptionIds: ["low"] },
              ],
            },
          },
        ]),
      ),
      project,
      resources,
    );
    expect(shareableAgentConfigurationCatalog(catalog, holdings)).toEqual({
      providers: [
        {
          id: "codex",
          label: "Codex",
          models: [{ id: "m1", label: "M1", thinkingOptions: [{ id: "low", label: "Low" }] }],
        },
      ],
    });
    expect(
      shareableAgentConfigurationCatalog(
        catalog,
        viewerHoldings(viewerAuthority(true, undefined), project, resources),
      ),
    ).toBe(catalog);
  });
});

describe("Can share on a level", () => {
  it("is hidden for Connect, a choice up to Full access, locked for Administrator", () => {
    expect(canShareState("daemon", ["daemon.connect"])).toBe("hidden");
    expect(canShareState("project", OFFICE_WORKER)).toBe("optional");
    expect(canShareState("project", [...OFFICE_WORKER, "hub.access.manage"])).toBe("optional");
    expect(canShareState("daemon", ["daemon.connect", ...OFFICE_WORKER, "workspace.manage"])).toBe(
      "optional",
    );
    expect(canShareState("daemon", ["daemon.connect", "daemon.manage"])).toBe("locked");
    expect(canShareState("team", ["hub.access.manage"])).toBe("hidden");
  });

  it("writes the privilege exactly as the switch shows it", () => {
    expect(withCanShare("project", OFFICE_WORKER, true)).toEqual([
      ...OFFICE_WORKER,
      "hub.access.manage",
    ]);
    expect(withCanShare("project", [...OFFICE_WORKER, "hub.access.manage"], false)).toEqual(
      OFFICE_WORKER,
    );
    expect(withCanShare("daemon", ["daemon.connect", "daemon.manage"], false)).toEqual([
      "daemon.connect",
      "daemon.manage",
      "hub.access.manage",
    ]);
    expect(withCanShare("team", ["hub.access.manage"], false)).toEqual(["hub.access.manage"]);
  });
});

describe("Terminal switch and profiles on a level", () => {
  const DEVELOPER_LEVEL = ["project.use", "terminal.profile.use"];
  it("offers the shell switch wherever a level launches profiles, never on Administrator", () => {
    expect(offersTerminalSwitch("project", DEVELOPER_LEVEL)).toBe(true);
    expect(offersTerminalSwitch("project", ["project.use"])).toBe(false);
    expect(offersTerminalSwitch("daemon", ["daemon.connect", "daemon.manage"])).toBe(false);
    expect(withTerminal("project", DEVELOPER_LEVEL, true)).toEqual([
      ...DEVELOPER_LEVEL,
      "terminal.use",
    ]);
    expect(withTerminal("project", [...DEVELOPER_LEVEL, "terminal.use"], false)).toEqual(
      DEVELOPER_LEVEL,
    );
    expect(levelSwitchPresets([...DEVELOPER_LEVEL, "terminal.use", "hub.access.manage"])).toEqual({
      canShare: true,
      terminal: true,
    });
  });

  it("passes on only the profiles the viewer holds, or all with the shell", () => {
    const catalog = [
      { id: "claude", name: "Claude Code" },
      { id: "codex", name: "Codex" },
    ];
    const grant = (privileges: string[], constraints: Record<string, unknown>) =>
      ({
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
      }) as unknown as ViewerAuthority;
    const profileHolder = viewerHoldings(
      grant(["project.use", "terminal.profile.use"], { terminalProfiles: ["claude"] }),
      host,
      [],
    );
    expect(shareableTerminalProfiles(catalog, profileHolder).map(({ id }) => id)).toEqual([
      "claude",
    ]);
    expect(sharesEveryTerminalProfile(profileHolder)).toBe(false);
    const shellHolder = viewerHoldings(grant(["project.use", "terminal.use"], {}), host, []);
    expect(shareableTerminalProfiles(catalog, shellHolder)).toHaveLength(2);
    expect(sharesEveryTerminalProfile(shellHolder)).toBe(true);
  });
});
