import { describe, expect, it } from "vitest";
import { PROMPT_SENTINEL } from "@clisbot/protocol/terminal-profiles";
import { launchableTerminalProfiles } from "./terminal-access.js";
import type { ProjectAuthorization, ProjectPrivilege } from "./types.js";

const profiles = [
  { id: "claude", name: "Claude Code", command: "claude", args: [PROMPT_SENTINEL] },
  { id: "ops", name: "Ops", command: "ssh", args: ["prod", "--token=SECRET"] },
];

function grant(
  privileges: ProjectPrivilege[],
  terminalProfiles?: ProjectAuthorization["terminalProfiles"],
): ProjectAuthorization {
  return {
    privileges: new Set(privileges),
    agentConfigurations: [],
    ...(terminalProfiles === undefined ? {} : { terminalProfiles }),
  };
}

describe("launchableTerminalProfiles", () => {
  it("gives Terminal every profile as configured, and the shell", () => {
    expect(launchableTerminalProfiles(profiles, grant(["project.use", "terminal.use"]))).toEqual({
      profiles,
      shell: true,
    });
    expect(launchableTerminalProfiles(profiles, "unrestricted").shell).toBe(true);
  });

  it("gives Terminal profiles only the granted ones, without their command or args", () => {
    expect(
      launchableTerminalProfiles(
        profiles,
        grant(["project.use", "terminal.profile.use"], ["claude"]),
      ),
    ).toEqual({
      profiles: [
        { id: "claude", name: "Claude Code", command: "", args: [PROMPT_SENTINEL], icon: "claude" },
      ],
      shell: false,
    });
  });

  it("gives nothing without a terminal privilege or outside the granted Projects", () => {
    expect(launchableTerminalProfiles(profiles, grant(["project.use"]))).toEqual({
      profiles: [],
      shell: false,
    });
    expect(launchableTerminalProfiles(profiles, null)).toEqual({ profiles: [], shell: false });
  });
});
